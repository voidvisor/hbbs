import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
    cookies().delete('user')
    return NextResponse.redirect(new URL("/login", "https://www.hagenabalva.lv"))
}