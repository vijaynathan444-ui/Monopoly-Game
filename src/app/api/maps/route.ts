import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const mapsDir = path.join(process.cwd(), 'src', 'maps');
  const files = fs.readdirSync(mapsDir).filter((f) => f.endsWith('.json'));
  const maps = files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(mapsDir, f), 'utf-8'));
    return { name: data.name, file: f.replace('.json', ''), description: data.description };
  });
  return NextResponse.json(maps);
}
