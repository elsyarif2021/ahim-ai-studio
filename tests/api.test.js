import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import ai from '../api/ai.js';
import video from '../api/video.js';

function mock(method='GET',body={}){
 const req={method,body};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(x){this.body=x;return this},send(x){this.body=x;return this}};
 return {req,res};
}
test('health accepts GET and rejects POST',()=>{
 let a=mock();health(a.req,a.res);assert.equal(a.res.statusCode,200);
 let b=mock('POST');health(b.req,b.res);assert.equal(b.res.statusCode,405);
});
test('AI rejects unsupported task without calling provider',async()=>{
 const a=mock('POST',{task:'unknown',prompt:'test'});await ai(a.req,a.res);assert.equal(a.res.statusCode,501);
});
test('AI rejects invalid base64 image before contacting provider',async()=>{
 const a=mock('POST',{task:'vision',prompt:'describe',image:'data:image/png;base64,not-valid!'});await ai(a.req,a.res);assert.equal(a.res.statusCode,400);
});
test('video is disabled by default',async()=>{
 const original=process.env.VIDEO_AI_ENABLED;delete process.env.VIDEO_AI_ENABLED;
 try{const a=mock('POST',{prompt:'create a sample video'});await video(a.req,a.res);assert.equal(a.res.statusCode,503)}
 finally{if(original===undefined)delete process.env.VIDEO_AI_ENABLED;else process.env.VIDEO_AI_ENABLED=original}
});
