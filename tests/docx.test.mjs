import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import createWord from '../api/docx.js';

const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function response(){
 return {
  headers:{},statusCode:200,body:null,
  setHeader(k,v){this.headers[k]=v;},
  status(code){this.statusCode=code;return this;},
  json(value){this.body=value;return this;},
  send(value){this.body=value;return this;}
 };
}
function unzipLocalHeaders(archive){
 assert.ok(Buffer.isBuffer(archive),'DOCX must be sent as actual ZIP bytes, not HTML');
 const files=new Map();let position=0;
 while(position<archive.length){
  const sig=archive.readUInt32LE(position);
  if(sig===0x02014b50||sig===0x06054b50)break;
  assert.equal(sig,0x04034b50,'Valid ZIP local header expected');
  const method=archive.readUInt16LE(position+8);
  const compressed=archive.readUInt32LE(position+18);
  const original=archive.readUInt32LE(position+22);
  const nameLength=archive.readUInt16LE(position+26);
  const extra=archive.readUInt16LE(position+28);
  const name=archive.subarray(position+30,position+30+nameLength).toString();
  const start=position+30+nameLength+extra;
  const packed=archive.subarray(start,start+compressed);
  const data=method===8?inflateRawSync(packed):packed;
  assert.equal(data.length,original,'Uncompressed size of '+name);
  files.set(name,data.toString('utf8'));
  position=start+compressed;
 }
 assert.equal(archive.readUInt32LE(position),0x02014b50,'ZIP central directory is present');
 assert.equal(archive.readUInt32LE(archive.length-22),0x06054b50,'ZIP end of central directory is present');
 return files;
}

test('Word download is real .docx OOXML, not renamed HTML',()=>{
 const req={method:'POST',body:{title:'Materi Sosiologi XII',text:'# Globalisasi & Perubahan Sosial\n\n**Pengertian:** Proses global.\n\n- Kerja sama\n- Media digital\n\n| Aspek | Contoh |\n| --- | --- |\n| Ekonomi | Perdagangan |\n| Budaya | Pertukaran tradisi |\n\nالنص العربي dan Bahasa Sunda.'}};
 const res=response();
 createWord(req,res);
 assert.equal(res.statusCode,200);
 assert.equal(res.headers['Content-Type'],mime);
 assert.match(res.headers['Content-Disposition'],/\.docx"$/);
 assert.equal(Number(res.headers['Content-Length']),res.body.length);
 assert.equal(res.body.subarray(0,2).toString(),'PK');
 const files=unzipLocalHeaders(res.body);
 for(const mandatory of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/styles.xml','word/_rels/document.xml.rels','docProps/core.xml','docProps/app.xml'])
  assert.ok(files.has(mandatory),'Missing DOCX part '+mandatory);
 const xml=files.get('word/document.xml');
 assert.match(xml,/<w:document/);
 assert.match(xml,/Globalisasi &amp; Perubahan Sosial/);
 assert.match(xml,/<w:pStyle w:val="Heading1"/);
 assert.match(xml,/<w:tbl>/);
 assert.match(xml,/<w:tr>/);
 assert.match(xml,/<w:b\/>/);
 assert.match(xml,/<w:bidi\/>/);
 assert.match(xml,/Bahasa Sunda/);
 assert.match(xml,/<w:pgSz w:w="11906" w:h="16838"\/>/);
 assert.doesNotMatch(xml,/<html/i);
 assert.ok(files.get('word/styles.xml').includes('Aptos'));
 assert.ok(files.get('[Content_Types].xml').includes('wordprocessingml.document.main+xml'));
});

test('DOCX escapes unsafe input as text rather than XML elements',()=>{
 const res=response();createWord({method:'POST',body:{title:'Materi <uji>',text:'<script>alert("x")</script> & tanda > lainnya'}},res);
 const xml=unzipLocalHeaders(res.body).get('word/document.xml');
 assert.match(xml,/&lt;script&gt;/);
 assert.match(xml,/&amp; tanda &gt;/);
 assert.doesNotMatch(xml,/<script>/);
});

test('Word endpoint refuses missing content or oversized content',()=>{
 let res=response();createWord({method:'POST',body:{text:' '}},res);
 assert.equal(res.statusCode,400);
 res=response();createWord({method:'POST',body:{text:'A'.repeat(180001)}},res);
 assert.equal(res.statusCode,400);
 res=response();createWord({method:'GET',body:{}},res);
 assert.equal(res.statusCode,405);
});

test('frontend requests docx from API and does not download HTML pretending to be Word',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/postJSON\('\/api\/docx',\{title,text:copy\}\)/);
 assert.match(html,/Unduh Word \(\.docx\)/);
 assert.match(html,/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
 assert.doesNotMatch(html,/downloadTextContent/);
 assert.doesNotMatch(html,/Unduh Dokumen HTML/);
 assert.doesNotMatch(html,/filename='AHIM-'\+\(titleName\|\|'hasil'\).*\.html/);
});
