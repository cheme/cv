var x;
var y;
var ctx;
var blobbuffer_size = 1024;
// nb line read from blob : 20
var readerline = 20;
// nb line displayed at the same time : 4
var innerreaderline = 4;

var wasm_mod = {};
//dim : 2480, 3508
//rowlen : 7440
function direct_display(b,ctx) {
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

function load_wasm_mod (cb) {
  fetch("cv.wasm").then(response =>
    response.arrayBuffer()
  ).then(bytes =>
    WebAssembly.instantiate(bytes, { env: { draw_px : draw_px } })
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

function compress_display(b,ctx) {
  var dec = (r) => {
   // TODO replace by read buffer!!
   var l = r.byteLength;
   var buf_read_add = wasm_mod.alloc(l);
   var buffer = new Uint8Array(wasm_mod.memory.buffer, buf_read_add, l);
   // copy TODO buff it
   buffer.set(new Uint8Array(r));
   // var buffer2 = new Uint8Array(wasm_mod.memory.buffer, buf_read_add, l);
   // this in debugging asserts that previous does copy mem on ff and chromium 
   // copy TODO buff it
   wasm_mod.decompress_display(buf_read_add,l,x / 4,innerreaderline);
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
    if (mode === 'direct') {
        direct_display(xhr.response,ctx);
    } else if (mode === 'compress') {
        compress_display(xhr.response,ctx);
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

export default cv;
