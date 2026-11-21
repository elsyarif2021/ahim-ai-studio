import { deflateRawSync } from 'node:zlib';

const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xmlEscape=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function zip(files){
  const local=[],central=[];let offset=0,centralSize=0;
  for(const [name,data] of files){
    const raw=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
    const packed=deflateRawSync(raw,{level:6}),filename=Buffer.from(name,'utf8');
    const crc=crc32(raw);if(filename.length>65535)throw Error('Nama dokumen tidak valid.');
    const a=Buffer.alloc(30);
    a.writeUInt32LE(0x04034b50,0);a.writeUInt16LE(20,4);a.writeUInt16LE(0x800,6);
    a.writeUInt16LE(8,8);a.writeUInt32LE(crc,14);a.writeUInt32LE(packed.length,18);
    a.writeUInt32LE(raw.length,22);a.writeUInt16LE(filename.length,26);
    const b=Buffer.alloc(46);
    b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);
    b.writeUInt16LE(0x800,8);b.writeUInt16LE(8,10);b.writeUInt32LE(crc,16);
    b.writeUInt32LE(packed.length,20);b.writeUInt32LE(raw.length,24);
    b.writeUInt16LE(filename.length,28);b.writeUInt32LE(offset,42);
    local.push(a,filename,packed);central.push(b,filename);
    offset+=a.length+filename.length+packed.length;centralSize+=b.length+filename.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end]);
}

function richText(source){
  const result=[];const re=/(\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|\x60[^\x60\n]+\x60)/g;
  let last=0;let hit;
  function run(value,kind=''){
    if(!value)return;
    const properties=kind==='bold'?'<w:b/>':kind==='italic'?'<w:i/>':kind==='code'?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>':'';
    result.push('<w:r>'+(properties?'<w:rPr>'+properties+'</w:rPr>':'')+'<w:t xml:space="preserve">'+xmlEscape(value)+'</w:t></w:r>');
  }
  while((hit=re.exec(source))){
    run(source.slice(last,hit.index));const raw=hit[0];
    if(raw.startsWith('**')||raw.startsWith('__'))run(raw.slice(2,-2),'bold');
    else if(raw.charCodeAt(0)===96)run(raw.slice(1,-1),'code');
    else run(raw.slice(1,-1),'italic');
    last=re.lastIndex;
  }
  run(source.slice(last));
  return result.join('')||'<w:r><w:t></w:t></w:r>';
}
function paragraph(content,style='Normal',opts={}){
  const rtl=/[\u0590-\u08ff]/.test(content);
  const pr='<w:pPr><w:pStyle w:val="'+style+'"/>'+
    (opts.indent?'<w:ind w:left="'+Math.max(0,Math.min(2400,opts.indent))+'"/>':'')+
    (rtl?'<w:bidi/>':'')+'</w:pPr>';
  return '<w:p>'+pr+richText(content)+'</w:p>';
}
function table(rows){
  const cols=Math.min(12,Math.max(...rows.map(row=>row.length)));
  const cells=rows.slice(0,200).map((row,index)=>'<w:tr>'+Array.from({length:cols},(_,col)=>{
    const txt=row[col]||'';
    const header=index===0?'<w:shd w:fill="DDEBE2"/>':'';
    return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>'+header+'</w:tcPr>'+
      paragraph(txt,index===0?'TableHeader':'TableText')+'</w:tc>';
  }).join('')+'</w:tr>').join('');
  const tblPr='<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>'+
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B2C6B7"/>'+
    '<w:left w:val="single" w:sz="4" w:color="B2C6B7"/>'+
    '<w:bottom w:val="single" w:sz="4" w:color="B2C6B7"/>'+
    '<w:right w:val="single" w:sz="4" w:color="B2C6B7"/>'+
    '<w:insideH w:val="single" w:sz="3" w:color="C8D5CA"/>'+
    '<w:insideV w:val="single" w:sz="3" w:color="C8D5CA"/></w:tblBorders></w:tblPr>';
  return '<w:tbl>'+tblPr+cells+'</w:tbl>';
}
function parseRow(line){
  if(!/^\s*\|.+\|\s*$/.test(line))return null;
  return line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.replace(/\\\|/g,'|').trim());
}
function isSeparatorRow(line){
  const fields=parseRow(line);return !!fields&&fields.length>=2&&fields.every(x=>/^:?-{3,}:?$/.test(x));
}
function bodyXml(text){
  const lines=text.replace(/\r\n?/g,'\n').split('\n');const out=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i],cells=parseRow(line);
    if(cells&&i+1<lines.length&&isSeparatorRow(lines[i+1])){
      const rows=[cells];i++;
      while(i+1<lines.length){
        const candidate=parseRow(lines[i+1]);if(!candidate||isSeparatorRow(lines[i+1]))break;
        rows.push(candidate);i++;
      }
      out.push(table(rows));continue;
    }
    const heading=line.match(/^\s*(#{1,4})\s+(.+)$/);
    if(heading){out.push(paragraph(heading[2],'Heading'+Math.min(3,heading[1].length)));continue;}
    const list=line.match(/^(\s*)[-*•]\s+(.+)$/);
    if(list){out.push(paragraph('•  '+list[2],'Normal',{indent:720+Math.min(3,Math.floor(list[1].length/2))*360}));continue;}
    const numbered=line.match(/^(\s*)(\d+[.)])\s+(.+)$/);
    if(numbered){out.push(paragraph(numbered[2]+'  '+numbered[3],'Normal',{indent:720+Math.min(3,Math.floor(numbered[1].length/2))*360}));continue;}
    out.push(paragraph(line));
  }
  return out.join('');
}

function createDocx(text,title='Hasil AI'){
  const name=xmlEscape(title.slice(0,150));
  const document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
  '<w:body>'+paragraph(title,'Title')+bodyXml(text)+
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'+
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/>'+
  '</w:sectPr></w:body></w:document>';

  const normal='<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'+
    '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>'+
    '<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Arial"/><w:sz w:val="22"/><w:color w:val="222D28"/></w:rPr></w:style>';
  const style=(id,size,color,bold=false,before=180,after=100)=>
    '<w:style w:type="paragraph" w:styleId="'+id+'"><w:name w:val="'+id+'"/>'+
    '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="'+before+'" w:after="'+after+'"/></w:pPr>'+
    '<w:rPr><w:color w:val="'+color+'"/><w:sz w:val="'+size+'"/>'+(bold?'<w:b/>':'')+'</w:rPr></w:style>';
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+normal+
    style('Title',34,'174D39',true,0,260)+style('Heading1',30,'173F30',true,260,140)+
    style('Heading2',26,'24593B',true,220,110)+style('Heading3',23,'24593B',true,160,80)+
    style('TableHeader',21,'173E2C',true,50,50)+style('TableText',21,'263D30',false,45,45)+
    '</w:styles>';
  const contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'+
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const relationships='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'+
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'+
    '</Relationships>';
  const documentRelationships='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
    '</Relationships>';
  const core='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '+
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '+
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'+
    '<dc:title>'+name+'</dc:title><dc:creator>AHIM AI Studio</dc:creator></cp:coreProperties>';
  const app='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'+
    '<Application>AHIM AI Studio</Application></Properties>';
  return zip([
    ['[Content_Types].xml',contentTypes],
    ['_rels/.rels',relationships],
    ['word/document.xml',document],
    ['word/styles.xml',styles],
    ['word/_rels/document.xml.rels',documentRelationships],
    ['docProps/core.xml',core],
    ['docProps/app.xml',app]
  ]);
}

export default function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Gunakan POST untuk mengunduh Word.'});
  const payload=req.body||{};
  const {text,title='Hasil AI'}=payload;
  if(typeof text!=='string'||!text.trim()||text.length>180000)
    return res.status(400).json({error:'Teks wajib diisi, maksimal 180.000 karakter.'});
  if(typeof title!=='string'||title.length>160)
    return res.status(400).json({error:'Judul dokumen tidak valid.'});
  const safeName=(title||'Hasil-AI').normalize('NFKD').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,70)||'Hasil-AI';
  try{
    const file=createDocx(text,title||'Hasil AI');
    res.setHeader('Content-Type',MIME);
    res.setHeader('Content-Disposition','attachment; filename="AHIM-'+safeName+'.docx"');
    res.setHeader('Content-Length',String(file.length));
    return res.status(200).send(file);
  }catch{
    return res.status(500).json({error:'Gagal menyusun dokumen Word DOCX.'});
  }
}
