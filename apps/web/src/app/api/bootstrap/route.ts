import { NextResponse } from "next/server";
import { getBootstrapData } from "@/lib/queries";

export async function GET() {
  const data = await getBootstrapData();
  return NextResponse.json(data);
}
