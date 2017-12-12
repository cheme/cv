var x;
var y;
var ctx;
var blob;
var blob_array_buff;
var reader = new FileReader();
var blobbuffer_size = 1024;
// nb line read from blob : 20
var readerline = 20;
// nb line displayed at the same time : 4
var innerreaderline = 4;

var wasm_mod = {};
//dim : 2480, 3508
//rowlen : 7440
function direct_display(b) {
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
            update_from_blob : update_from_blob
    } })
  ).then(results => {
    console.log("got instance");
    console.log(results);
    console.log(results.instance.exports);
    let mod = results.instance;
    wasm_mod.alloc = mod.exports.alloc;
    wasm_mod.dealloc = mod.exports.dealloc;
    wasm_mod.decompress_display  = mod.exports.decompress_display;
    wasm_mod.memory = mod.exports.memory;
    cb();
  });
}

function compress_display() {
  var b = blob;
  b.cur_ix = 0;
  var dec = (r) => {
   // TODO replace by read buffer!!
   var l = r.byteLength;
   blob_array_buff = r;
   var buff_l = Math.min(l,blobbuffer_size);
   var buf_read_add = wasm_mod.alloc(buff_l);
   wasm_mod.decompress_display(buf_read_add, buff_l,l,x / 4,innerreaderline);
          // TODO put in promise and dealloc in finally
   wasm_mod.dealloc(buf_read_add);
  };
  var rcb = function () {
    if (wasm_mod.decompress_display == undefined) {
      var r = this.result;
      load_wasm_mod(() => {
        dec(r);
      });

    } else {
      dec(this.result);
    }
  }
  var reader = new FileReader();
  reader.addEventListener("loadend", rcb);
  reader.readAsArrayBuffer(b); 
}



// use by webassembly module
function draw_px(array_pt,nb_line,line_w,y_ix) {
  var buffer = new Uint8ClampedArray(wasm_mod.memory.buffer, array_pt, nb_line * 4 * line_w);
  draw_px_inner(buffer,nb_line,line_w,y_ix);
}

function update_from_blob(array_pt, arr_l, ret_l) {
  var end_r = Math.min(blob.cur_ix+arr_l,blob_array_buff.byteLength);
  var length = end_r - blob.cur_ix;
  var buffer = new Uint8Array(wasm_mod.memory.buffer, array_pt, length);
  buffer.set(new Uint8Array(blob_array_buff.slice(blob.cur_ix,end_r)));
  blob.cur_ix = end_r;

  var res_buf = new Uint8Array(wasm_mod.memory.buffer, ret_l, 4);
  putInt32Bytes( length,res_buf );
}

function draw_px_inner(buffer,nb_line,line_w,y_ix) {
  var idi = new ImageData(buffer,line_w, nb_line);
  ctx.putImageData(idi,0,y_ix);
}


function download_cv(ctx2,file,mode,pass) {
  ctx = ctx2;
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
        compress_display();
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


function putInt32Bytes( x,bytes ){
    var i = 0;
    do {
    bytes[i++] = x & (255);
    x = x>>8;
    } while ( i < 4 )
    return bytes;
}

export default cv;
