import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMemberNameFromId } from './Members.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getGotmNominations(): Promise<string> {
    const fileContent = await readFile(path.resolve(__dirname, "../data/gotmNominations.json"));
    const gotNominations = JSON.parse(fileContent);

    let nominationOutput: string = "**Current GOTM Nominations**\n";

    for (let x: number = 0; x < gotNominations.length; x++) {
        const nom = gotNominations[x];

        const name: string | null = await getMemberNameFromId(nom.nominator)
        nominationOutput += `${x + 1}) ${nom.title} -- ${name}\n`;
    }

    return nominationOutput;
}

function readFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
