/**
 * DOCX → plain text.
 *
 * The Claude document content block accepts PDF, not DOCX, so a .docx resume has
 * to be reduced to text before it can be parsed. A .docx is a ZIP whose
 * `word/document.xml` holds the body, so this reads exactly that one entry
 * rather than pulling in a ZIP library: `DecompressionStream` handles the only
 * compression method Word actually emits.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const DOCUMENT_ENTRY = 'word/document.xml';

export class DocxError extends Error {}

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD is last, but a trailing comment can push it back up to 64KB.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new DocxError('Not a valid .docx file (no ZIP end-of-directory record).');
}

type Entry = { method: number; compressedSize: number; localOffset: number };

function findEntry(view: DataView, bytes: Uint8Array, name: string): Entry {
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new DocxError('Corrupt .docx central directory.');
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (entryName === name) {
      return {
        method: view.getUint16(cursor + 10, true),
        compressedSize: view.getUint32(cursor + 20, true),
        localOffset: view.getUint32(cursor + 42, true),
      };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new DocxError(`Not a valid .docx file (${name} is missing).`);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** Paragraph and tab markers survive as whitespace; every other tag is dropped. */
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function docxToText(file: Uint8Array): Promise<string> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const entry = findEntry(view, file, DOCUMENT_ENTRY);

  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = file.subarray(start, start + entry.compressedSize);

  let raw: Uint8Array;
  if (entry.method === 0) {
    raw = compressed;
  } else if (entry.method === 8) {
    raw = await inflate(compressed);
  } else {
    throw new DocxError(`Unsupported .docx compression method ${entry.method}.`);
  }

  const text = xmlToText(new TextDecoder().decode(raw));
  if (text.length < 50) {
    throw new DocxError('No readable text found in this .docx file.');
  }
  return text;
}
