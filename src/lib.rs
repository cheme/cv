//! wasm utilities for pic display

#![feature(link_args)]

use compress::lz4::{
  Decoder as LZDec,
};
use std::os::raw::c_char;

extern {
//function draw_px(array,ctx,nb_line,line_w,y_ix) {
  fn draw_px(*mut c_char);
}

//function direct_display(b,ctx) {
#[no_mangle]
pub fn decompress_display(buff : *mut c_char) {
}


