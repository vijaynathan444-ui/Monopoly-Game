import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const detail = searchParams.get('detail');

  const mapsDir = path.join(process.cwd(), 'src', 'maps');
  const files = fs.readdirSync(mapsDir).filter((f) => f.endsWith('.json'));
  const maps = files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(mapsDir, f), 'utf-8'));
    const base = { name: data.name, file: f.replace('.json', ''), description: data.description, tileCount: data.tiles?.length || 0 };
    if (detail === 'true') {
      return { ...base, tiles: data.tiles };
    }
    return base;
  });
  return NextResponse.json(maps);
}
