'use server'

import pool from "@/app/lib/db";
import { cookies } from "next/headers";
import { checkUser } from "@/app/lib/actions";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID, scryptSync } from "crypto";
import { read, utils } from "xlsx";
import QRCode from "qrcode";
import { ImageRun, Paragraph, Table, TableCell, TableRow, TextRun, Document, Packer } from "docx";


interface Top {
    nominID: string;
    top_izveles: {
        izvele: string;
        count: number;
    }[];
}

export async function getVoterAmount() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [amount] = await connection.query("SELECT COUNT(*) FROM users");
        return Number(amount['COUNT(*)']) - 1;
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function getNominatedAmount() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [amount] = await connection.query(`
            SELECT COUNT(*)
            FROM users
            WHERE nominets = 1 AND role = 'voter'
        `);
        return Number(amount['COUNT(*)']);
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function getVotedAmount() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [amount] = await connection.query(`
            SELECT COUNT(*)
            FROM users
            WHERE balsots = 1 AND role = 'voter'
        `);
        return Number(amount['COUNT(*)']);
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function getTop5() {
    let connection;
    try {
        connection = await pool.getConnection();
        const results = await connection.query(`
            WITH ranked_values AS (
                SELECT nominID, izvele, COUNT(*) as count, ROW_NUMBER() OVER (PARTITION BY nominID ORDER BY count DESC) as rn
                FROM karta1
                GROUP BY nominID, izvele
                ORDER BY count DESC
            )
            SELECT nominID, JSON_ARRAYAGG(JSON_OBJECT('izvele', izvele, 'count', count)) as top_izveles
            FROM ranked_values
            WHERE rn <= 5
            GROUP BY nominID
        `) as Top[];
        return results;
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function getElite() {
    let connection;
    try {
        connection = await pool.getConnection();
        const results = await connection.query(`
            WITH ranked_values AS (
                SELECT nominID, izvele, COUNT(*) as count
                FROM karta2
                GROUP BY nominID, izvele
                ORDER BY count DESC
            )
            SELECT nominID, JSON_ARRAYAGG(JSON_OBJECT('izvele', izvele, 'count', count)) as top_izveles
            FROM ranked_values
            GROUP BY nominID
        `) as Top[];
        return results;
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function setFinalists(_currentState: unknown, formData: FormData) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    const finalisti = Array.from(formData.entries())
    console.log(finalisti)
    while (finalisti[0][0].startsWith('$')) {
        finalisti.shift()
    }
    
    if (finalisti.length != 3) {
        return { success: false, message: "Nepieciešams izvēlēties trīs finālistus!" }
    }

    const nominID = finalisti[0][0]

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(`
            DELETE FROM finalists
            WHERE nominID = ?
        `, [nominID]);
        for (let i = 0; i < finalisti.length; i++) {
            await connection.query(`
                INSERT INTO finalists
                VALUES (?, ?)
            `, [nominID, finalisti[i][1]]);
        }
        return { success: true, message: "Finālisti izvēlēti!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function changePassword(_currentState: unknown, formData: FormData) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    const password = formData.get('new')
    if ((password as string).length < 1) {
        return { success: false, message: "Nepieciešama parole!" }
    }
    const salt = randomBytes(16).toString('hex')
    const buf = scryptSync(password as string, salt, 64) as Buffer
    const hashed = `admin:${buf.toString('hex')}.${salt}`
    cookies().set('user', hashed, { secure: true, httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 1 })

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(`
            UPDATE users
            SET id = ?
            WHERE role = 'admin'
        `, [hashed]);
        return { success: true, message: "Parole mainīta!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function setPeople(_currentState: unknown, formData: FormData, type: 0 | 1) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }
    
    const file = formData.get('file')
    if (!(file as File).name.endsWith('.xlsx')) {
        return { success: false, message: "Nepieciešams augšupielādēt .xlsx failu!" }
    }

    const source = type ? 'skolotaji' : 'skoleni'
    const fileBuf = Buffer.from(await (file as File).arrayBuffer())
    let connection;
    try {
        const wb = read(fileBuf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data: string[][] = utils.sheet_to_json(ws, { header: 1 })

        connection = await pool.getConnection();
        await connection.query(`TRUNCATE TABLE ${source}`);

        const headers = data[0];
        for (const header of headers) {
            const values = data.slice(1).map(row => row[headers.indexOf(header)]);
            for (let i = 0; i < values.length; i++) {
                if (typeof values[i] === 'undefined') continue
                await connection.query(`
                    INSERT INTO ${source}
                    VALUES (?, ?)
                `, [header, values[i]]);
            }
        }
        return { success: true, message: "Fails veiksmīgi augšupielādēts!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function updateNomin(formData: FormData, id: string, tips: 'skolenu' | 'skolotaju') {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(`
            REPLACE INTO nominacijas (tips, id, virsraksts, apraksts)
            VALUES (?, ?, ?, ?)
        `, [tips, id, formData.get('virsraksts'), formData.get('apraksts')]);
        return { success: true, message: "Nominācija veiksmīgi rediģēta!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function removeNomin(id: string) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(`
            DELETE FROM nominacijas
            WHERE id = ?
        `, [id]);
        return { success: true, message: "Nominācija veiksmīgi izdzēsta!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function generateUUID() {
    return randomUUID();
}

export async function getTimestamps() {
    let connection;
    try {
        connection = await pool.getConnection();
        const timestamps = await connection.query("SELECT * FROM timestamps");
        return timestamps;
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.end();
    }
}

export async function setTimestamps(_currentState: unknown, formData: FormData, offset: number) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    const timezoneOffset = (new Date().getTimezoneOffset() - offset) * 60 * 1000;

    const nominStart = Date.parse(formData.get('nominacijas_sakums') as string) - timezoneOffset
    const nominEnd = Date.parse(formData.get('nominacijas_beigas') as string) - timezoneOffset
    const balssStart = Date.parse(formData.get('balsosana_sakums') as string) - timezoneOffset
    const balssEnd = Date.parse(formData.get('balsosana_beigas') as string) - timezoneOffset

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(`
            UPDATE timestamps
            SET start = ?, end = ?
            WHERE period = 'nominacijas'
        `, [nominStart, nominEnd]);
        await connection.query(`
            UPDATE timestamps
            SET start = ?, end = ?
            WHERE period = 'balsosana'
        `, [balssStart, balssEnd]);
        return { success: true, message: "Laiki veiksmīgi mainīti!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function deleteEverything() {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query("TRUNCATE TABLE karta1");
        await connection.query("TRUNCATE TABLE karta2");
        await connection.query(`
            UPDATE users
            SET nominets = 0, balsots = 0
        `);
        return { success: true, message: "Visi dati dzēsti!" }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}

export async function generateCodes(formData: FormData) {
    const user = cookies().get('user')?.value
    let dbuser;

    if (user) {
        dbuser = await checkUser(user as string)
        if (!dbuser || !dbuser.admin) {
            redirect('/login')
        }
    } else {
        redirect('/login')
    }

    const type = formData.get('type') as string
    if (type !== 'new' && type !== 'more') {
        return { success: false, message: 'Nepareizs tips!' }
    }
    const amount = parseInt(formData.get('amount') as string)
    if (amount < 1) {
        return { success: false, message: 'Nevar ģenerēt 0 kodus!' }
    }

    let codes = []
    let qrCodes: string[] = []
    for (let i = 0; i < amount; i++) {
        const code = randomUUID().split('-')[0]
        codes.push(code)
        qrCodes.push(await QRCode.toDataURL(
            `https://www.hagenabalva.lv/login?code=${code}`,
            {
                type: 'image/png',
                errorCorrectionLevel: 'H',
            }
        ))
    }

    const numRows = Math.ceil(amount / 4)
    let cells = []
    for (let i = 0; i < amount; i++) {
        cells.push(
            new TableCell({
                children: [
                    new Paragraph({
                        children: [
                            new ImageRun({
                                data: qrCodes[i],
                                transformation: {
                                    width: 180,
                                    height: 180,
                                },
                            }),
                            new TextRun({
                                text: 'https://www.hagenabalva.lv',
                                break: 1,
                                size: 20,
                            }),
                            new TextRun({
                                text: `Kods: ${codes[i]}`,
                                break: 1,
                                size: 22,
                            }),
                        ]
                    })
                ]
            })
        )
    }

    let rows = []
    for (let i = 0; i < numRows; i++) {
        let theseCells = []
        for (let j = i*4; j < (i+1)*4; j++) {
            theseCells.push(cells[j])
        }
        rows.push(
            new TableRow({
                children: theseCells
            })
        )
    }

    const table = new Table({
        rows: rows
    })

    const doc = new Document({
        sections: [{
            children: [table],
            properties: {
                page: {
                    margin: {
                        bottom: 415,
                        left: 415,
                        right: 415,
                        top: 415
                    }
                }
            }
        }]
    })
    
    const docBase64 = await Packer.toBase64String(doc)

    let connection;
    try {
        connection = await pool.getConnection();
        if (type === 'new') {
            await connection.query(`
                DELETE FROM users
                WHERE role = 'voter'
            `);
        }
        for (const code of codes) {
            await connection.query(`
                INSERT INTO users (id, role)
                VALUES (?, 'voter')
            `, [code]);
        }
        return { success: true, message: "Kodi veiksmīgi pievienoti!", file: docBase64 }
    } catch (error) {
        console.error(error);
        return { success: false, message: "Datubāzes kļūda!" }
    } finally {
        if (connection) connection.end();
    }
}