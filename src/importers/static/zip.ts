/**
 * Leitor de arquivos ZIP no browser, sem dependências: lê o diretório central e descomprime
 * só os ficheiros pedidos (métodos «store» e «deflate», com `DecompressionStream`).
 * Nada do arquivo é executado. Os limites protegem contra arquivos enormes ou «bombas»
 * de compressão: o tamanho descomprimido é contado enquanto se descomprime, não só o declarado.
 */

export interface ZipLimits {
  /** Tamanho máximo do ficheiro .zip. */
  maxArchiveBytes: number;
  /** Número máximo de entradas (ficheiros e pastas). */
  maxEntries: number;
  /** Tamanho máximo de um ficheiro depois de descomprimido. */
  maxFileBytes: number;
  /** Soma máxima dos tamanhos descomprimidos. */
  maxTotalBytes: number;
}

export const ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 2000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 150 * 1024 * 1024,
};

export interface ZipEntry {
  /** Caminho normalizado (separador «/», sem «./»). */
  path: string;
  size: number;
  compressedSize: number;
  method: number;
  /** Deslocamento do cabeçalho local. */
  offset: number;
}

/** Entradas ignoradas, com o motivo (vão para o relatório). */
export interface ZipSkipped {
  path: string;
  reason: string;
}

export interface ZipArchive {
  entries: ZipEntry[];
  skipped: ZipSkipped[];
  read(entry: ZipEntry): Promise<Uint8Array>;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7) && (bytes[3] === 4 || bytes[3] === 6 || bytes[3] === 8);
}

/**
 * Valida e normaliza um caminho do arquivo. Recusa caminhos absolutos, com unidade («C:»),
 * com «..», com caracteres de controlo ou demasiado longos (nunca saem da pasta do site).
 */
export function normalizeEntryPath(raw: string): { path: string } | { error: string } {
  if (raw.length > 400) return { error: 'caminho com mais de 400 caracteres' };
  if ([...raw].some((ch) => ch.charCodeAt(0) < 32)) return { error: 'caminho com caracteres de controlo' };
  const unified = raw.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) return { error: 'caminho absoluto' };
  const parts: string[] = [];
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return { error: 'caminho com «..» (sairia da pasta do site)' };
    parts.push(part);
  }
  if (parts.length === 0) return { error: 'caminho vazio' };
  return { path: parts.join('/') };
}

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

export function readZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
  if (bytes.length > limits.maxArchiveBytes) throw new ZipError(`O arquivo tem ${mb(bytes.length)}; o máximo é ${mb(limits.maxArchiveBytes)}.`);
  if (!isZip(bytes)) throw new ZipError('O ficheiro não é um arquivo ZIP válido.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('O arquivo ZIP está incompleto ou danificado (diretório central não encontrado).');
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new ZipError('Arquivos ZIP64 (mais de 65 535 ficheiros ou mais de 4 GB) não são suportados.');
  if (total > limits.maxEntries) throw new ZipError(`O arquivo tem ${total} entradas; o máximo é ${limits.maxEntries}.`);
  if (cdOffset + cdSize > bytes.length) throw new ZipError('O arquivo ZIP está danificado (diretório central fora do ficheiro).');

  const decoder = new TextDecoder('utf-8');
  const legacy = new TextDecoder('latin1');
  const entries: ZipEntry[] = [];
  const skipped: ZipSkipped[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError('O arquivo ZIP está danificado (entrada do diretório central inválida).');
    const versionMadeBy = view.getUint16(p + 4, true);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const externalAttrs = view.getUint32(p + 38, true);
    const offset = view.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    // Bit 11: nome em UTF-8; sem ele, os arquivos antigos usam CP437 (aproximado por latin1).
    const rawName = (flags & 0x800 ? decoder : legacy).decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;

    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue; // pasta
    if (IGNORED.some((re) => re.test(rawName.replace(/\\/g, '/')))) continue;
    const norm = normalizeEntryPath(rawName);
    if ('error' in norm) {
      skipped.push({ path: rawName, reason: norm.error });
      continue;
    }
    const unixMode = versionMadeBy >> 8 === 3 ? externalAttrs >>> 16 : 0;
    if ((unixMode & 0xf000) === 0xa000) {
      skipped.push({ path: norm.path, reason: 'ligação simbólica (não é seguida)' });
      continue;
    }
    if (flags & 0x1) {
      skipped.push({ path: norm.path, reason: 'ficheiro cifrado (com palavra-passe)' });
      continue;
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ path: norm.path, reason: `método de compressão ${method} não suportado` });
      continue;
    }
    if (size === 0xffffffff || compressedSize === 0xffffffff) {
      skipped.push({ path: norm.path, reason: 'ficheiro ZIP64 não suportado' });
      continue;
    }
    if (size > limits.maxFileBytes) {
      skipped.push({ path: norm.path, reason: `ficheiro com ${mb(size)} descomprimido; o máximo por ficheiro é ${mb(limits.maxFileBytes)}` });
      continue;
    }
    const key = norm.path.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ path: norm.path, reason: 'caminho repetido no arquivo' });
      continue;
    }
    seen.add(key);
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) throw new ZipError(`O conteúdo descomprimido passa de ${mb(limits.maxTotalBytes)}, o máximo permitido.`);
    entries.push({ path: norm.path, size, compressedSize, method, offset });
  }

  let readTotal = 0;
  const read = async (entry: ZipEntry): Promise<Uint8Array> => {
    const o = entry.offset;
    if (o + 30 > bytes.length || view.getUint32(o, true) !== 0x04034b50) throw new ZipError(`O ficheiro «${entry.path}» está danificado no arquivo.`);
    const start = o + 30 + view.getUint16(o + 26, true) + view.getUint16(o + 28, true);
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new ZipError(`O ficheiro «${entry.path}» está incompleto no arquivo.`);
    const raw = bytes.subarray(start, end);
    // Limite efetivo: o declarado pode mentir; conta-se o que sai do descompressor.
    const cap = Math.min(limits.maxFileBytes, entry.size);
    const out = entry.method === 0 ? raw.slice() : await inflate(raw, cap, entry.path);
    if (out.length !== entry.size) throw new ZipError(`O ficheiro «${entry.path}» não corresponde ao tamanho declarado no arquivo.`);
    readTotal += out.length;
    if (readTotal > limits.maxTotalBytes) throw new ZipError(`O conteúdo descomprimido passa de ${mb(limits.maxTotalBytes)}, o máximo permitido.`);
    return out;
  };
  return { entries, skipped, read };
}

async function inflate(raw: Uint8Array, cap: number, path: string): Promise<Uint8Array> {
  const copy = new Uint8Array(raw.length);
  copy.set(raw);
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
  const stream = input.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > cap) {
        await reader.cancel();
        throw new ZipError(`O ficheiro «${path}» descomprime para mais do que o tamanho declarado no arquivo.`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError(`Não foi possível descomprimir «${path}» (dados danificados).`);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
