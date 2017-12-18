let x;
let y;
let ctx;
let logarea;
let blob;
let blob_array_buff;
let blob_down_buffs = [];
let reader = new FileReader();
let blobbuffer_size = 1024;
// nb line read from blob : 20
let readerline = 20;
// nb line displayed at the same time : 4
let innerreaderline = 4;

let wasm_mod = {};

function log_area(s) {
  console.log(s);
  logarea.value += s;
  logarea.value += '\n';
}
//dim : 2480, 3508
//rowlen : 7440
function direct_display() {
  let start = new Date();

  let b = blob;
  console.log(b.size)
  console.log(b.type)
  console.log('x: ', x);
  console.log('y: ', y);
  // line counter
  ctx.sy = 0;
  let rcb = function(r) {
    // reader.result contains the contents of blob as a typed array
    // console.log("in buf callback")
    for (let i=0; i < r.result.byteLength; i+= x * innerreaderline) {
      draw_px_inner(new Uint8ClampedArray(r.result.slice(i,i+(x*innerreaderline))),innerreaderline,x/4,ctx.sy);
      ctx.sy += innerreaderline;
    }

    if (ctx.sy >= y/4) {
        let dur = new Date() - start;
        log_area("Direct display took : " + dur + " ms");
    }
  };

  let readersize = readerline * x;
  for (let i=0; i < b.size; i+= readersize) {
    let fr = preader(b,i,i+readersize).then(rcb);
    // need to run in order in firefox, use of then after resolve still lead to race (only for very small buf)
    // TODO use Promise.race
    Promise.resolve(fr);
/*    let reader = new FileReader();
    reader.addEventListener("loadend", rcb);
    reader.readAsArrayBuffer(b.slice(i,i+readersize)); 
    */
  }

}
// for debugging only
function touch (ix) {
  console.log("touch : " + ix);
}

function wasm_log(msg,err) {
  let strMsg = "Webassembly error : " + copyCStr(wasm_mod, msg);
  switch (err) {
    case 1 :
      console.error(strMsg);
      break;
    case 2 :
      alert(strMsg);
      break;
    default :
      console.log(strMsg);
  }
}

function load_wasm_mod (cb) {
  fetch("cv.wasm").then(response =>
    response.arrayBuffer()
  ).then(bytes =>
    WebAssembly.instantiate(bytes, { env: {
            touch : touch,
            wasm_log : wasm_log,
            draw_px : draw_px,
            update_from_blob : update_from_blob,
            down_buf_add : down_buf_add,
    } })
  ).then(results => {
    console.log("got instance");
    console.log(results);
    console.log(results.instance.exports);
    let mod = results.instance;
    wasm_mod.alloc = mod.exports.alloc;
    wasm_mod.dealloc = mod.exports.dealloc;
    wasm_mod.decompress_display  = mod.exports.decompress_display;
    wasm_mod.decompress_enc_display  = mod.exports.decompress_enc_display;
    wasm_mod.enc_display  = mod.exports.enc_display;
    wasm_mod.enc_download  = mod.exports.enc_download;
    wasm_mod.bcrypt_key_der  = mod.exports.bcrypt_key_der;
    wasm_mod.memory = mod.exports.memory;
    wasm_mod.pbkdf_test = mod.exports.pbkdf_test;
    cb();
  });
}

function compress_display(pass) {
  let start = new Date();
  let b = blob;
  b.cur_ix = 0;
  let dec = function() {
  
/*let start = new Date();
          // dirty key deriv test to choose nb round
          //wasm_mod.pbkdf_test(parseInt(pass));
          wasm_mod.pbkdf_test(16);
   let end = new Date();
          console.log("took " + (end - start));
          log_area("key derivation in " + (end - start) + " ms");
*/
   // TODO replace by read buffer!!
   let r = this.result;
   let l = r.byteLength;
   blob_array_buff = r;
   let buff_l = Math.min(l,blobbuffer_size);
   let buf_read_add = wasm_mod.alloc(buff_l);
   wasm_mod.decompress_display(buf_read_add, buff_l,x / 4,innerreaderline);
          // TODO put in promise and dealloc in finally
   wasm_mod.dealloc(buf_read_add);
   let dur = new Date() - start;
   log_area("Lz4 uncompress (buff size " + buff_l + ") then display took : " + dur + " ms");
  };
  let reader = new FileReader();
  reader.addEventListener("loadend", dec);
  reader.readAsArrayBuffer(b); 
}
// TODO fuse with compress_display (use dec as param)
function compress_enc_display(pass,modeconf) {
  return enc_inner(pass,modeconf,wasm_mod.decompress_enc_display," and Lz4 uncompress", false)
}
function enc_only_display(pass,modeconf) {
  return enc_inner(pass,modeconf,wasm_mod.enc_display," from uncompress blob", false)
}
function enc_down_pdf(pass,modeconf) {
  return enc_inner(pass,modeconf,wasm_mod.enc_download," from pdf blob", true)
}

function enc_inner(pass,modeconf,asm_dec,logz4, is_pdf_down) {
  let b = blob;
  b.cur_ix = 0;
  let dec = function() {

   let r = this.result;
   let start = new Date();

   let nb_round;
   let keyder_salt;
   let ciph_salt;
   if (is_pdf_down) {
     ciph_salt = modeconf.pdfsalt;
     nb_round = modeconf.pdfkeyder.nbround;
     keyder_salt = modeconf.pdfkeyder.salt;
     blob_down_buffs = [];
   } else {
     ciph_salt = modeconf.salt;
     nb_round = modeconf.keyder.nbround;
     keyder_salt = modeconf.keyder.salt;
   }
   // dirty key der exception management
   if (pass.length == 0) {
      pass = ' ';
   }
   let pass_bytes = stringToBytes(pass);
   console.log("pass : " + btoa(pass_bytes));
   let p_l = pass_bytes.length;
   let buf_pass = wasm_mod.alloc(p_l);
   new Uint8Array(wasm_mod.memory.buffer, buf_pass, p_l).set(new Uint8Array(pass_bytes));
  
   let buf_salt = wasm_mod.alloc(32);
   let b_salt = new Uint8Array(wasm_mod.memory.buffer, buf_salt, 32);
   let byte_salt = atob(keyder_salt);
   for(let i = 0; i < 32; i++) {
     b_salt[i] = byte_salt.charCodeAt(i);
   }

   console.log("salt bcrypt : " + btoa(String.fromCharCode.apply(null, b_salt)));

   let buf_pass_der = wasm_mod.bcrypt_key_der(buf_pass, p_l, buf_salt, nb_round)
   wasm_mod.dealloc(buf_pass);
   let dur = new Date() - start;
   log_area("bcript " + nb_round + " round key derivation in " + dur + " ms");
        
   let bder = new Uint8Array(wasm_mod.memory.buffer, buf_pass_der, 32);
   console.log("pass der : " + btoa(String.fromCharCode.apply(null, bder)));

   start = new Date();

   // shorter cipher salt
   b_salt = new Uint8Array(wasm_mod.memory.buffer, buf_salt, 24);
   byte_salt = atob(ciph_salt);
   for(let i = 0; i < 24; i++) {
     b_salt[i] = byte_salt.charCodeAt(i);
   }

   console.log("salt xchacha : " + btoa(String.fromCharCode.apply(null, b_salt)));


   let l = r.byteLength;
   blob_array_buff = r;
   let buff_l = Math.min(l,blobbuffer_size);
   let buf_read_add = wasm_mod.alloc(buff_l);

   asm_dec(buf_read_add, buff_l,x / 4,innerreaderline,buf_pass_der,buf_salt);
          // TODO put in promise and dealloc in finally
   wasm_mod.dealloc(buf_read_add);
   wasm_mod.dealloc(buf_pass_der);
   wasm_mod.dealloc(buf_salt);
   dur = new Date() - start;
   let add_log;
   if (is_pdf_down) {
     load_result_pdf_blog();
     add_log = " and new down blog init took";
   } else {
     add_log = " and display took";
   }
   log_area("xChaCha20 dec (wasm buf 3*64 byte)" + logz4 + " (read buff size " + buff_l + ")" + add_log + " : " + dur + " ms");
  };
  let reader = new FileReader();
  reader.addEventListener("loadend", dec);
  reader.readAsArrayBuffer(b); 
}

function load_result_pdf_blog() {
  let file = new Blob(blob_down_buffs, {type: 'application/pdf'});
  let fileURL = URL.createObjectURL(file);
//  window.open(fileURL);
  window.location.href = fileURL;
  //blob_down_buffs = [];
}

function down_buf_add(buf, buf_l) {

  let buffer = new Uint8Array(buf_l);
  buffer.set(new Uint8Array(wasm_mod.memory.buffer, buf, buf_l));
  blob_down_buffs.push(buffer);

}

function load_wasm(dec) {
  if (wasm_mod.decompress_display == undefined) {
    load_wasm_mod(() => {
      dec();
    });

  } else {
    dec();
  }
}



// use by webassembly module
function draw_px(array_pt,nb_line,line_w,y_ix) {
  let buffer = new Uint8ClampedArray(wasm_mod.memory.buffer, array_pt, nb_line * 4 * line_w);
  draw_px_inner(buffer,nb_line,line_w,y_ix);
}

function update_from_blob(array_pt, arr_l) {
  let end_r = Math.min(blob.cur_ix+arr_l,blob_array_buff.byteLength);
  let length = end_r - blob.cur_ix;
  let buffer = new Uint8Array(wasm_mod.memory.buffer, array_pt, length);
  buffer.set(new Uint8Array(blob_array_buff.slice(blob.cur_ix,end_r)));
  blob.cur_ix = end_r;

  return length;
}

function draw_px_inner(buffer,nb_line,line_w,y_ix) {
  let idi = new ImageData(buffer,line_w, nb_line);
  ctx.putImageData(idi,0,y_ix);
}


function download_cv(ctx2,file,mode,mode_conf,pass,logarea2) {
  if (mode_conf.read_buffer_size != undefined) {
    blobbuffer_size = mode_conf.read_buffer_size;
  }
  if (mode_conf.nb_line_disp != undefined) {
    innerreaderline = mode_conf.nb_line_disp;
  }

  ctx = ctx2;
  logarea = logarea2;
  log_area("Using canvas " + ctx.canvas.width + "px per " + ctx.canvas.height + "px");
  x = ctx.canvas.width*4;
  y = ctx.canvas.height*4;
/* blocking promise for firefox may not be enough
 * if (navigator.userAgent.search("Firefox") > 0) {
    // firefox do run blob reading with concurrency!! : avoid race 
    // TODO use specifiz moz event
    readerline = ctx.canvas.height;
  }*/
  let xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.onload = () => {
    // xhr.response is a Blob
    let url = URL.createObjectURL(xhr.response);
    console.log('URL: ', url);
    blob = xhr.response;
    if (mode === 'direct') {
        direct_display();
    } else if (mode === 'compress') {
        load_wasm(() => compress_display(pass));
    } else if (mode === 'compress_enc') {
        load_wasm(() => compress_enc_display(pass,mode_conf));
    } else if (mode === 'enc_only') {
        load_wasm(() => enc_only_display(pass,mode_conf));
    } else {
        console.log("unknow deser mode");
    }
  };
  xhr.open('GET',file);
  xhr.send();
}
function download_pdf(file,mode_conf,pass,logarea2) {
  if (mode_conf.read_buffer_size != undefined) {
    blobbuffer_size = mode_conf.read_buffer_size;
  }
  log_area("Download of a pdf with canvas read buf size " + mode_conf.read_buffer_size);
  let xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.onload = () => {
    // xhr.response is a Blob
    let url = URL.createObjectURL(xhr.response);
    console.log('URL: ', url);
    blob = xhr.response;
    load_wasm(() => enc_down_pdf(pass,mode_conf));
  };
  xhr.open('GET',file);
  xhr.send();
}


let cv = {
   download : download_cv,
   download_pdf : download_pdf,
};


function preader (b,start,end) {
 return new Promise(function (resolve, reject) {
  let reader = new FileReader();

  reader.onload = function () {
   resolve(reader);
  };
  reader.onerror = reject;

  reader.readAsArrayBuffer(b.slice(start,end)); 
 });
}

// copied from sample, is generator efficient ? (does not currently matter for use case)
function copyCStr(module, ptr) {
  let orig_ptr = ptr;
  const collectCString = function* () {
    let memory = new Uint8Array(module.memory.buffer);
    while (memory[ptr] !== 0) {
      if (memory[ptr] === undefined) { throw new Error("Tried to read undef mem") }
      yield memory[ptr]
      ptr += 1
    }
  }

  const buffer_as_u8 = new Uint8Array(collectCString())
  const utf8Decoder = new TextDecoder("UTF-8");
  const buffer_as_utf8 = utf8Decoder.decode(buffer_as_u8);
  module.dealloc(orig_ptr);
  return buffer_as_utf8
}

// non utf8!! do not use out of poc
function stringToBytes(str) {
let bytesv2 = []; // char codes

for (let i = 0; i < str.length; ++i) {
  let code = str.charCodeAt(i);
  
  bytesv2 = bytesv2.concat([code & 0xff]);
}
return bytesv2
}

export default cv;
