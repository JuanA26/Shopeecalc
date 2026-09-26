// Penulis file Excel (.xlsx) minimal tanpa dependensi: .xlsx = arsip ZIP berisi XML.
// Dipakai untuk ekspor data diagnostik (eksporData.js). Sel angka ditulis sebagai angka,
// teks sebagai inline string; baris pertama tiap sheet = judul kolom (tebal, dibekukan, filter).
const zlib = require('node:zlib');

const escapeXml = (s) => String(s)
  // Karakter kontrol tidak sah di XML (kecuali tab/baris baru) dibuang.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function namaKolom(i) { // 0 → A, 25 → Z, 26 → AA
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sel(nilai, ref, gaya) {
  const s = gaya ? ` s="${gaya}"` : '';
  if (nilai === null || nilai === undefined || nilai === '') return '';
  if (typeof nilai === 'number') return Number.isFinite(nilai) ? `<c r="${ref}"${s}><v>${nilai}</v></c>` : '';
  if (typeof nilai === 'boolean') return `<c r="${ref}" t="inlineStr"${s}><is><t>${nilai ? 'ya' : 'tidak'}</t></is></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(nilai)}</t></is></c>`;
}

function xmlSheet({ kolom, baris }) {
  const semua = [kolom, ...baris];
  const lebar = kolom.map((k, i) => Math.min(60, Math.max(8, ...semua.slice(0, 200).map((b) => String(b[i] ?? '').length + 2))));
  const akhir = `${namaKolom(kolom.length - 1)}${semua.length}`;
  const isi = semua.map((b, r) => `<row r="${r + 1}">${kolom.map((_, c) => sel(b[c], `${namaKolom(c)}${r + 1}`, r === 0 ? 1 : 0)).join('')}</row>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${lebar.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${isi}</sheetData>` +
    (baris.length ? `<autoFilter ref="A1:${akhir}"/>` : '') +
    '</worksheet>';
}

// Nama sheet Excel: ≤ 31 karakter, tanpa []:*?/\ dan unik.
function namaSheetAman(nama, dipakai) {
  let n = String(nama).replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet';
  for (let i = 2; dipakai.has(n.toLowerCase()); i++) n = `${String(nama).slice(0, 28)}_${i}`;
  dipakai.add(n.toLowerCase());
  return n;
}

// ZIP (metode deflate) — cukup untuk xlsx. zlib.crc32 ada sejak Node 22.2 (engines: ≥ 22.5).
function zip(berkas) {
  const lokal = [], pusat = [];
  let offset = 0;
  for (const { nama, isi } of berkas) {
    const data = Buffer.from(isi, 'utf8'), padat = zlib.deflateRawSync(data), namaBuf = Buffer.from(nama, 'utf8');
    const crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); // waktu 00:00, tanggal 1980-01-01
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(padat.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(namaBuf.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(padat.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(namaBuf.length, 28); c.writeUInt32LE(offset, 42);
    lokal.push(h, namaBuf, padat); pusat.push(c, namaBuf);
    offset += h.length + namaBuf.length + padat.length;
  }
  const cd = Buffer.concat(pusat), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(berkas.length, 8); e.writeUInt16LE(berkas.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, cd, e]);
}

// sheets: [{ nama, kolom: ['judul', ...], baris: [[nilai, ...], ...] }] → Buffer .xlsx
function buatXlsx(sheets) {
  const dipakai = new Set();
  const daftar = sheets.map((s) => ({ ...s, nama: namaSheetAman(s.nama, dipakai) }));
  const ns = 'http://schemas.openxmlformats.org';
  const filter = daftar.map((s, i) => s.baris.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.nama.replace(/'/g, "''")}'!$A$1:$${namaKolom(s.kolom.length - 1)}$${s.baris.length + 1}</definedName>` : '').join('');
  return zip([
    { nama: '[Content_Types].xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${daftar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nama: '_rels/.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nama: 'xl/workbook.xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${daftar.map((s, i) => `<sheet name="${escapeXml(s.nama)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filter ? `<definedNames>${filter}</definedNames>` : ''}</workbook>` },
    { nama: 'xl/_rels/workbook.xml.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">${daftar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${daftar.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nama: 'xl/styles.xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...daftar.map((s, i) => ({ nama: `xl/worksheets/sheet${i + 1}.xml`, isi: xmlSheet(s) })),
  ]);
}

module.exports = { buatXlsx, namaKolom };
