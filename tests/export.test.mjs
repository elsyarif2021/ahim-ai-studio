import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const client=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(client,'Missing Studio browser script');

test('image result activates copy and PNG download without a ReferenceError',async()=>{
  const snippet=client.match(/async function imageResult\(blob\)\{[\s\S]*?(?=\nasync function loadVideoStatus\(\))/)?.[0];
  assert.ok(snippet,'Image renderer missing');
  const blob=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
  const dom={
    result:{items:[],append(value){this.items.push(value);}},
    download:{disabled:true,textContent:''},
    copy:{disabled:true,textContent:''},
    exactTitle:{value:'SEKOLAH BERSIH'}
  };
  const state={blob:null,filename:'',objectUrl:null};
  let message='',labelText='';
  const ctx={
    state,
    $:id=>dom[id],
    composeImage:async()=>blob,
    clearResults:()=>{state.blob=null;dom.download.disabled=true;dom.copy.disabled=true;},
    document:{createElement:tag=>({tagName:tag})},
    URL:{createObjectURL:()=> 'blob:local-image'},
    label:text=>{labelText=text;},
    resultMsg:text=>{message=text;}
  };
  const render=vm.runInNewContext(snippet+'\nimageResult',ctx);
  await render(blob);
  assert.equal(dom.download.disabled,false,'PNG download must be enabled');
  assert.equal(dom.copy.disabled,false,'Image clipboard button must be enabled');
  assert.equal(state.filename,'AHIM-Prompt-Kilat-Desain.png');
  assert.equal(state.blob,blob);
  assert.match(labelText,/Judul ditambahkan/);
  assert.match(message,/Unduh PNG/);
});

test('Auto 5 Gaya ZIP has valid local headers and central directory',async()=>{
  const snippet=client.match(/function crc32\(bytes\)\{[\s\S]*?(?=\nasync function downloadResult\(\))/)?.[0];
  assert.ok(snippet,'ZIP helper missing');
  const ctx={TextEncoder,Uint8Array,DataView,Blob};
  const pack=vm.runInNewContext(snippet+'\npackageImagesZip',ctx);
  const originals=[
    {name:'AHIM-1.png',bytes:Uint8Array.from([1,2,3,4,5])},
    {name:'AHIM-2.png',bytes:Uint8Array.from([4,0,3,7])}
  ];
  const archive=await pack(originals.map(f=>({name:f.name,blob:new Blob([f.bytes],{type:'image/png'})})));
  assert.equal(archive.type,'application/zip');
  const data=new Uint8Array(await archive.arrayBuffer()),view=new DataView(data.buffer);
  assert.equal(view.getUint32(data.length-22,true),0x06054b50,'ZIP end record');
  assert.equal(view.getUint16(data.length-22+10,true),2,'ZIP file count');
  const cdOffset=view.getUint32(data.length-22+16,true);
  assert.equal(view.getUint32(cdOffset,true),0x02014b50,'ZIP central-directory record');
  let offset=0;
  for(const file of originals){
    assert.equal(view.getUint32(offset,true),0x04034b50,'ZIP local-file header');
    const size=view.getUint32(offset+18,true),n=view.getUint16(offset+26,true);
    assert.equal(size,file.bytes.length);
    const filename=new TextDecoder().decode(data.slice(offset+30,offset+30+n));
    assert.equal(filename,file.name);
    const body=data.slice(offset+30+n,offset+30+n+size);
    assert.deepEqual(Array.from(body),Array.from(file.bytes),'ZIP file bytes must be unchanged');
    offset+=30+n+size;
  }
  assert.equal(offset,cdOffset);
});

test('copy text falls back to document clipboard command on restricted browsers',async()=>{
  const snippet=client.match(/async function clipboardText\(text\)\{[\s\S]*?(?=\nasync function copyImage\(blob\))/)?.[0];
  assert.ok(snippet,'Clipboard fallback missing');
  let copied=false;
  const field={value:'',style:{},setAttribute(){},focus(){},select(){},
    setSelectionRange(){},remove(){}};
  const ctx={
    navigator:{},
    document:{
      createElement:()=>field,
      body:{append(){}},
      activeElement:{focus(){}},
      execCommand:(command)=>{copied=command==='copy';return copied;}
    },
    Error
  };
  const copy=vm.runInNewContext(snippet+'\nclipboardText',ctx);
  await copy('Uji salin teks');
  assert.equal(field.value,'Uji salin teks');
  assert.equal(copied,true);
});

test('video URL is offered for opening/saving and copying instead of disabled buttons',()=>{
  assert.match(client,/state\.externalUrl=found\.url/);
  assert.match(client,/Salin Link MP4/);
  assert.match(client,/Buka \/ Simpan MP4/);
  assert.match(client,/Unduh Semua \(ZIP\)/);
  assert.match(client,/navigator\.share/);
});
