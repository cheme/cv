var x;
var y;
var ctx;
// nb line read from blob
var readerline = 20;
// nb line displayed at the same time
var innerreaderline = 4;
//dim : 2480, 3508
//rowlen : 7440
function direct_display(b,ctx) {
  console.log(b.size)
  console.log(b.type)
  console.log('x: ', x);
  console.log('y: ', y);
  // line counter
  ctx.sy = 0;
  var rcb = function() {
   // reader.result contains the contents of blob as a typed array
//             console.log("in buf callback")
    for (var i=0; i < this.result.byteLength; i+= x * innerreaderline) {
      draw_px(new Uint8ClampedArray(this.result.slice(i,i+(x*innerreaderline))),ctx,innerreaderline,x/4,ctx.sy);
      ctx.sy += innerreaderline;
    }
  };

  var readersize = readerline * x;
  for (var i=0; i < b.size; i+= readersize) {
    var reader = new FileReader();
    reader.addEventListener("loadend", rcb);
    reader.readAsArrayBuffer(b.slice(i,i+readersize)); 
  }

}

// use by webassembly module
function draw_px(array,ctx,nb_line,line_w,y_ix) {
  var idi = new ImageData(array,line_w, nb_line);
  ctx.putImageData(idi,0,y_ix);
}

function download_cv(ctx2,file,mode,pass) {
  ctx = ctx2;
  x = ctx.canvas.width*4;
  y = ctx.canvas.height*4;
  if (navigator.userAgent.search("Firefox") > 0) {
    // firefox do run blob reading with concurrency!! : avoid race 
    // TODO use specifiz moz event
    readerline = ctx.canvas.height;
  }
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.onload = function() {
    // xhr.response is a Blob
    var url = URL.createObjectURL(xhr.response);
    console.log('URL: ', url);
    if (mode === 'direct') {
        direct_display(xhr.response,ctx);
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

export default cv;
