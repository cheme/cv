var x;
var y;
var ctx;
var logarea;
var blob;
var blob_array_buff;
var reader = new FileReader();
var blobbuffer_size = 1024;
// nb line read from blob : 20
var readerline = 20;
// nb line displayed at the same time : 4
var innerreaderline = 4;

var wasm_mod = {};

function log_area(s) {
  console.log(s);
  logarea.value += s;
  logarea.value += '\n';
}
//dim : 2480, 3508
//rowlen : 7440
function direct_display(b) {
  var start = new Date();

  var b = blob;
  console.log(b.size)
  console.log(b.type)
  console.log('x: ', x);
  console.log('y: ', y);
  // line counter
  ctx.sy = 0;
  var rcb = function(r) {
   // reader.result contains the contents of blob as a typed array
//             console.log("in buf callback")
    for (var i=0; i < r.result.byteLength; i+= x * innerreaderline) {
      draw_px_inner(new Uint8ClampedArray(r.result.slice(i,i+(x*innerreaderline))),innerreaderline,x/4,ctx.sy);
      ctx.sy += innerreaderline;
    }

    if (ctx.sy >= y/4) {
        var dur = new Date() - start;
        log_area("Direct display took : " + dur + " ms");
    }
  };

  var readersize = readerline * x;
  for (var i=0; i < b.size; i+= readersize) {
    var fr = preader(b,i,i+readersize).then(rcb);
    // need to run in order in firefox, use of then after resolve still lead to race (only for very small buf)
    // TODO use Promise.race
    Promise.resolve(fr);
/*    var reader = new FileReader();
    reader.addEventListener("loadend", rcb);
    reader.readAsArrayBuffer(b.slice(i,i+readersize)); 
    */
  }

}
// for debugging only
function touch (ix) {
  console.log("touch : " + ix);
}
function load_wasm_mod (cb) {
  fetch("cv.wasm").then(response =>
    response.arrayBuffer()
  ).then(bytes =>
    WebAssembly.instantiate(bytes, { env: {
            touch : touch,
            draw_px : draw_px,
            update_from_blob : update_from_blob,
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
    wasm_mod.bcrypt_key_der  = mod.exports.bcrypt_key_der;
    wasm_mod.memory = mod.exports.memory;
    wasm_mod.pbkdf_test = mod.exports.pbkdf_test;
    cb();
  });
}

function compress_display(pass) {
        var start = new Date();
          var b = blob;
  b.cur_ix = 0;
  var dec = (r) => {
/*var start = new Date();
          // dirty key deriv test to choose nb round
          //wasm_mod.pbkdf_test(parseInt(pass));
          wasm_mod.pbkdf_test(16);
   var end = new Date();
          console.log("took " + (end - start));
          log_area("key derivation in " + (end - start) + " ms");
*/
   // TODO replace by read buffer!!
   var start = new Date();
   var l = r.byteLength;
   blob_array_buff = r;
   var buff_l = Math.min(l,blobbuffer_size);
   var buf_read_add = wasm_mod.alloc(buff_l);
   wasm_mod.decompress_display(buf_read_add, buff_l,l,x / 4,innerreaderline);
          // TODO put in promise and dealloc in finally
   wasm_mod.dealloc(buf_read_add);
   var dur = new Date() - start;
   log_area("Lz4 uncompress and display took : " + dur + " ms");
 

  };
  var rcb = function () {
     dec(this.result);
  }
  var reader = new FileReader();
  reader.addEventListener("loadend", rcb);
  reader.readAsArrayBuffer(b); 
}
// TODO fuse with compress_display (use dec as param)
function compress_enc_display(pass,modeconf) {
  return enc_inner(pass,modeconf,wasm_mod.decompress_enc_display)
}
function enc_only_display(pass,modeconf) {
  return enc_inner(pass,modeconf,wasm_mod.enc_display)
}
function enc_inner(pass,modeconf,asm_dec) {
    var b = blob;
  b.cur_ix = 0;
  var dec = (r) => {

   var start = new Date();

   var nb_round = modeconf.keyder.nbround;
   // dirty key der exception management
   if (pass.length == 0) {
      pass = ' ';
   }
   var pass_bytes = stringToBytes(pass);
   console.log("pass : " + btoa(pass_bytes));
   var p_l = pass_bytes.length;
   var buf_pass = wasm_mod.alloc(p_l);
   var b_pass = new Uint8Array(wasm_mod.memory.buffer, buf_pass, p_l);
   b_pass.set(new Uint8Array(pass_bytes));
  
   var buf_salt = wasm_mod.alloc(32);
   var b_salt = new Uint8Array(wasm_mod.memory.buffer, buf_salt, 32);
   var byte_salt = atob(modeconf.keyder.salt);
   for(var i = 0; i < 32; i++) {
     b_salt[i] = byte_salt.charCodeAt(i);
   }

   console.log("salt : " + btoa(String.fromCharCode.apply(null, b_salt)));

   var buf_pass_der = wasm_mod.bcrypt_key_der(buf_pass, p_l, buf_salt, nb_round)
   wasm_mod.dealloc(buf_pass);
   var dur = new Date() - start;
   log_area("bcript " + nb_round + " round key derivation in " + dur + " ms");
        
   var bder = new Uint8Array(wasm_mod.memory.buffer, buf_pass_der, 32);
   console.log("pass der : " + btoa(String.fromCharCode.apply(null, bder)));

   start = new Date();

   // shorter cipher salt
   b_salt = new Uint8Array(wasm_mod.memory.buffer, buf_salt, 24);
   byte_salt = atob(modeconf.salt);
   for(var i = 0; i < 24; i++) {
     b_salt[i] = byte_salt.charCodeAt(i);
   }



   // TODO replace by read buffer!!
   var l = r.byteLength;
   blob_array_buff = r;
   var buff_l = Math.min(l,blobbuffer_size);
   var buf_read_add = wasm_mod.alloc(buff_l);
   asm_dec(buf_read_add, buff_l,l,x / 4,innerreaderline,buf_pass_der,buf_salt);
          // TODO put in promise and dealloc in finally
   wasm_mod.dealloc(buf_read_add);
   wasm_mod.dealloc(buf_pass_der);
   wasm_mod.dealloc(buf_salt);
   dur = new Date() - start;
   log_area("xChaCha20 dec and Lz4 uncompress and display took : " + dur + " ms");
 

  };
  var rcb = function () {
    dec(this.result);
  }
  var reader = new FileReader();
  reader.addEventListener("loadend", rcb);
  reader.readAsArrayBuffer(b); 
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
  var buffer = new Uint8ClampedArray(wasm_mod.memory.buffer, array_pt, nb_line * 4 * line_w);
  draw_px_inner(buffer,nb_line,line_w,y_ix);
}

function update_from_blob(array_pt, arr_l) {
  var end_r = Math.min(blob.cur_ix+arr_l,blob_array_buff.byteLength);
  var length = end_r - blob.cur_ix;
  var buffer = new Uint8Array(wasm_mod.memory.buffer, array_pt, length);
  buffer.set(new Uint8Array(blob_array_buff.slice(blob.cur_ix,end_r)));
  blob.cur_ix = end_r;

  return length;
}

function draw_px_inner(buffer,nb_line,line_w,y_ix) {
  var idi = new ImageData(buffer,line_w, nb_line);
  ctx.putImageData(idi,0,y_ix);
}


function download_cv(ctx2,file,mode,mode_conf,pass,logarea2) {
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
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.onload = () => {
    // xhr.response is a Blob
    var url = URL.createObjectURL(xhr.response);
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

var cv = {
   download : download_cv
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



// non utf8!!
function stringToBytes(str) {
var bytesv2 = []; // char codes

for (var i = 0; i < str.length; ++i) {
  var code = str.charCodeAt(i);
  
  bytesv2 = bytesv2.concat([code & 0xff]);
}
return bytesv2
}
export default cv;
