'use strict';
const path = require('path');
const os = require('os');
const fsModule = require('fs');
const SUPPORTED_EXTS = new Set(['.txt','.md','.js','.ts','.py','.json','.csv','.html','.css','.yaml','.yml']);
const CHUNK_SIZE = 600, CHUNK_OVERLAP = 80, MAX_FILE_SIZE = 512*1024;
class RagService {
  constructor() { this.chunks=[]; this.vectors=[]; this.vocabulary=new Map(); this.indexed=new Set(); }
  indexDirectory(dir) {
    if(!dir||!fsModule.existsSync(dir)||this.indexed.has(dir)) return 0;
    this.indexed.add(dir); let added=0;
    const visit=(d,depth)=>{
      if(depth>5||this.chunks.length>=5000) return;
      let entries; try{entries=fsModule.readdirSync(d,{withFileTypes:true});}catch{return;}
      for(const e of entries){
        if(e.name.startsWith('.')||['node_modules','__pycache__','.git','dist','build'].includes(e.name)) continue;
        const full=path.join(d,e.name);
        if(e.isDirectory()){visit(full,depth+1);continue;}
        const ext=path.extname(e.name).toLowerCase();
        if(!SUPPORTED_EXTS.has(ext)) continue;
        try{
          const stat=fsModule.statSync(full);
          if(stat.size>MAX_FILE_SIZE) continue;
          const text=fsModule.readFileSync(full,'utf8');
          const chunks=this._chunk(text);
          for(let i=0;i<chunks.length;i++){this.chunks.push({text:chunks[i],source:full,chunkIndex:i});this.vectors.push(this._tfidf(chunks[i]));added++;}
          if(this.chunks.length>=5000) break;
        }catch{}
      }
    };
    visit(dir,0); return added;
  }
  indexDefaults(){const dirs=[path.join(os.homedir(),'Documents'),path.join(os.homedir(),'Desktop'),path.join(os.homedir(),'Downloads')];let t=0;for(const d of dirs)t+=this.indexDirectory(d);return t;}
  _chunk(text){const c=[];const s=text.replace(/\r\n/g,'\n').trim();if(s.length<=CHUNK_SIZE){c.push(s);return c;}let pos=0;while(pos<s.length){c.push(s.slice(pos,Math.min(pos+CHUNK_SIZE,s.length)));pos+=CHUNK_SIZE-CHUNK_OVERLAP;if(pos>=s.length)break;}return c;}
  _tfidf(text){const tokens=this._tokenize(text);const tf=new Map();for(const t of tokens)tf.set(t,(tf.get(t)||0)+1);const vec={};for(const[term,count]of tf){if(!this.vocabulary.has(term))this.vocabulary.set(term,this.vocabulary.size);vec[this.vocabulary.get(term)]=count/tokens.length;}return vec;}
  _tokenize(text){return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t=>t.length>2&&t.length<30);}
  _cosine(a,b){let dot=0,mA=0,mB=0;for(const[k,v]of Object.entries(a)){dot+=v*(b[k]||0);mA+=v*v;}for(const v of Object.values(b))mB+=v*v;return mA&&mB?dot/(Math.sqrt(mA)*Math.sqrt(mB)):0;}
  search(query,topK=5){if(!query||!this.chunks.length)return[];const qv=this._tfidf(query);return this.chunks.map((chunk,i)=>({chunk,score:this._cosine(qv,this.vectors[i])})).sort((a,b)=>b.score-a.score).slice(0,topK).filter(r=>r.score>0).map(r=>({...r.chunk,score:Math.round(r.score*1000)/1000}));}
  async answer(query,provider){
    if(!provider||typeof provider.complete!=='function') throw new Error('AI provider is required.');
    if(!this.chunks.length) this.indexDefaults();
    const results=this.search(query,6);
    if(!results.length) return{summary:'No relevant local documents found.',answer:'I could not find any local files relevant to your question.'};
    const context=results.map((r,i)=>'[Source '+(i+1)+': '+path.basename(r.source)+']\n'+r.text).join('\n\n---\n\n');
    const reply=await provider.complete([{role:'system',content:'You are JARVIS. Answer using ONLY the provided document context. Cite the source file.'},{role:'user',content:'Context:\n\n'+context+'\n\nQuestion: '+query}]);
    const text=typeof reply==='string'?reply:reply.text||'No answer.';
    return{summary:'Found answer from local file(s).',answer:text,sources:[...new Set(results.map(r=>path.basename(r.source)))],chunksUsed:results.length};
  }
  stats(){return{chunks:this.chunks.length,indexedDirs:[...this.indexed],vocabularySize:this.vocabulary.size};}
}
module.exports={RagService};
