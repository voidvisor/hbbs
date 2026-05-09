'use server'

import { UUID, scryptSync, timingSafeEqual } from "crypto";
import pool from "@/app/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";


export type timestamp = {
  period: string,
  start: number,
  end: number
}

export type Grupa = {
  grupa: string;
  cilveki: string[];
};


export type Nomin = {
  tips: 'skolenu' | 'skolotaju';
  id: UUID;
  virsraksts: string;
  apraksts: string;
};

export type Finalists = {
  id: UUID;
  cilveki: string[];
}

export type Izvele = {
  nominID: UUID;
  izvele: string;
}

export async function authenticate(_currentState: unknown, formData: FormData) {
  const user = formData.get('code')
  try {
    const dbuser = await checkUser(user as string)
    if (dbuser) {
      if ((user as string).startsWith('admin:')) {
        cookies().set('user', dbuser.cookie as string, {secure: true, httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 1})
        return {success: true, admin: true}
      } else {
        cookies().set('user', user as string, {secure: true, httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 1})
        return {success: true}
      }
    } else {
      return {success: false, message: "Balsošanas kods nepastāv!"}
    }
  } catch (error) {
    console.error(error)
    return {success: false, message: "Datubāzes kļūda!"}
  }
}

export async function checkUser(userID: string) {
  const userCookie = cookies().get('user')
  userID = decodeURIComponent(userID)
  let connection;
  try {
    connection = await pool.getConnection();
    const [user] = await connection.query("SELECT * FROM users WHERE id = ?", [userID]);
    if (userID.startsWith('admin:')) {
      const [admin] = await connection.query("SELECT * FROM users WHERE role = 'admin'");
      const [hashed, salt] = admin.id.replace('admin:', '').split('.');
      const hashedBuf = Buffer.from(hashed, 'hex');
      if (userID.length == 167) {
        const [testHash] = userID.replace('admin:', '').split('.');
        const testBuf = Buffer.from(testHash, 'hex');
        if (timingSafeEqual(hashedBuf, testBuf)) {
          return {admin: true, cookie: `admin:${testBuf.toString('hex')}.${salt}`}
        }
      }
      const testBuf = scryptSync(userID.replace('admin:', ''), salt, 64) as Buffer;
      if (timingSafeEqual(hashedBuf, testBuf)) {
        return {admin: true, cookie: `admin:${testBuf.toString('hex')}.${salt}`}
      }
    }
    if (!user) {
      if (userCookie) {
        redirect('/logout')
      }
      return null
    } else {
      return {nominets: user.nominets, balsots: user.balsots, admin: false}
    }
  } catch (error) {
    console.error(error)
    throw error
  } finally {
    if (connection) connection.end();
  }
}

export async function checkTime() { 
  let timestamps;
  let connection;
  try {
    connection = await pool.getConnection();
    timestamps = await connection.query("SELECT * FROM timestamps");
  } catch (error) {
    console.error(error)
  } finally {
    if (connection) connection.end();
  }
  const now = new Date();
  if (now < timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").start) {
    return [0, timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").start]
  } else if (now > timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").start && now < timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").end) {
    return [1, timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").end]
  } else if (now > timestamps.find((timestamp: timestamp) => timestamp.period == "nominacijas").end && now < timestamps.find((timestamp: timestamp) => timestamp.period == "balsosana").start) {
    return [2, timestamps.find((timestamp: timestamp) => timestamp.period == "balsosana").start]
  } else if (now > timestamps.find((timestamp: timestamp) => timestamp.period == "balsosana").start && now < timestamps.find((timestamp: timestamp) => timestamp.period == "balsosana").end) {
    return [3, timestamps.find((timestamp: timestamp) => timestamp.period == "balsosana").end]
  } else {
    return [4, 0]
  }
}

export async function getGrupas(source: string) {
  let grupas: Grupa[] = [];
  let connection;
  try {
    connection = await pool.getConnection();
    const result = (await connection.query(`
      SELECT grupa, GROUP_CONCAT(vards ORDER BY vards SEPARATOR ',') AS cilveki
      FROM ${source}
      GROUP BY grupa
      ORDER BY grupa
    `)) as { grupa: string, cilveki: string }[]

    grupas = result.map(({ grupa, cilveki }) => ({ grupa, cilveki: cilveki.split(',') }))

  } catch (error) {
    console.error(error)
  } finally {
    if (connection) connection.end();
  }
  return grupas;
}

export async function getNominacijas() {
  let nominacijas: Nomin[] = [];
  let connection;
  try {
    connection = await pool.getConnection();
    const result = (await connection.query(`
      SELECT *
      FROM nominacijas
      ORDER BY virsraksts
    `)) as { tips: 'skolenu'|'skolotaju', id: UUID, virsraksts: string, apraksts: string }[]
    nominacijas = result
  } catch (error) {
    console.error(error)
  } finally {
    if (connection) connection.end();
  }
  return nominacijas;
}

export async function getFinalists() {
  let finalists: Finalists[] = [];
  let connection;
  try {
    connection = await pool.getConnection();
    const result = (await connection.query(`
      SELECT nominID, GROUP_CONCAT(vards ORDER BY vards SEPARATOR ';') as cilveki
      FROM finalists
      GROUP BY nominID
    `)) as { nominID: UUID, cilveki: string }[]
    finalists = result.map(({ nominID: id, cilveki }) => ({ id, cilveki: cilveki.split(';') }))
  } catch (error) {
    console.error(error)
  } finally {
    if (connection) connection.end();
  }
  return finalists;
}

export async function submitForm(_currentState: unknown, formData: FormData) {
  const period = await checkTime()
  const user = cookies().get('user')?.value
  let dbuser;
  
  if (user) {
    dbuser = await checkUser(user as string)
    if (!dbuser) {
      redirect('/login')
    }
  } else {
    redirect('/login')
  }

  if (period[0] == 1 && dbuser.nominets || period[0] == 3 && dbuser.balsots) {
    return {success: false, message: `Ar šo kodu jau vienreiz ${period[0] == 1 ? 'nominēts' : 'balsots'}!`}

  }
  
  const votes = Array.from(formData.entries())
  while (votes[0][0].startsWith('$')) {
    votes.shift()
    if (votes.length < 1) {
      return {success: false, message: "Nepieciešams balsot par vismaz vienu nomināciju!"}
    }
  }
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(`
      UPDATE users
      SET ${period[0] == 1 ? 'nominets' : period[0] == 3 && 'balsots'} = 1
      WHERE id = ?
    `, [user])
    for (const entry of votes) {
      await connection.query(`
        INSERT INTO ${period[0] == 1 ? 'karta1' : period[0] == 3 && 'karta2'}
        VALUES (?, ?, ?)
      `, [user, entry[0], entry[1]])
    }
    return {success: true, message: "Balsošana veiksmīga!"}
  } catch (error) {
    console.error(error)
    return {success: false, message: "Datubāzes kļūda!"}
  } finally {
    if (connection) connection.end();
  }
}

export async function getChoices(period: number) {
  const user = cookies().get('user')?.value
  let dbuser;
  
  if (user) {
    dbuser = await checkUser(user as string)
    if (!dbuser) {
      redirect('/login')
    }
  } else {
    redirect('/login')
  }

  let choices: Izvele[] = [];

  let connection;
  try {
    connection = await pool.getConnection();
    const result = (await connection.query(`
      SELECT nominID, izvele
      FROM ${period == 1 ? 'karta1' : period == 3 && 'karta2'}
      WHERE userID = ?
    `, [user])) as Izvele[]
    choices = result
  } catch (error) {
    console.error(error)
  } finally {
    if (connection) connection.end();
  }
  return choices
}