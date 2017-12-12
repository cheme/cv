//! wasm utilities for pic display

#![feature(allocator_api)]
#![feature(link_args)]

extern crate compress;

use std::heap::{Alloc, Heap, Layout};
use std::mem;
use std::cmp::min;

use std::slice;
use std::iter::repeat;
use compress::lz4::{
  Decoder as LZDec,
};
use std::os::raw::{
  c_char,
  c_void,
};
use std::ffi::{
  CStr,
  CString,
};
use std::io::{
  Cursor,
  Read,
  Write,
  Result as IoResult,
};

extern {
//function draw_px(array,ctx,nb_line,line_w,y_ix) {
  fn draw_px(_ : *mut u8, _ : usize, _ : usize, _ : usize);
  fn update_from_blob(_ : *mut u8, _ : usize, _ : *mut i32);
  fn touch(_ : usize);
}

//function direct_display(b,ctx) {
#[no_mangle]
pub extern "C" fn decompress_display(empty_buff: *mut u8, buf_length : usize, length : usize, width : usize, nb_line_disp : usize) {
  let empty_buff = unsafe {
    slice::from_raw_parts_mut(empty_buff, buf_length)
  }; 

  let input = BlobReader::new(empty_buff);

  //let mut disp_buf = Vec::with_capacity(width * 4 * nb_line_disp);
  let mut disp_buf = vec![0;width * 4 * nb_line_disp];

	let mut dec_i = LZDec::new(input);

  let mut y_ix = 0;
  loop {
    let mut i = 0;
    while i < disp_buf.len() {
      let nbr = dec_i.read(&mut disp_buf[i..]).unwrap();
      if nbr == 0 {
        break;
      }
      i += nbr;
    }
    if i == 0 {
      break;
    }
    unsafe { draw_px(disp_buf.as_mut_ptr(), nb_line_disp, width, y_ix) };
    y_ix += nb_line_disp;
  }
  

/*
  println!("string length: {}", b.len());
  let mut input = Cursor::new(data.to_bytes());
  let mut buf = vec![0;10];

  let mut nbread = 0;

  loop {
    let n = input.read(&mut buf[..]).unwrap();
    nbread += n;
  }*/
}

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
  unsafe {
    let layout = Layout::from_size_align(size, mem::align_of::<u8>()).unwrap();
    Heap.alloc(layout).unwrap()
  }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, size: usize) {
  unsafe  {
    let layout = Layout::from_size_align(size, mem::align_of::<u8>()).unwrap();
    Heap.dealloc(ptr, layout);
  }
}

/* alternate impl for alloc dealloc kept for testing

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut c_void {
  let mut buf = Vec::with_capacity(size);
  let ptr = buf.as_mut_ptr();
  mem::forget(buf);
  return ptr as *mut c_void;
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut c_void, cap: usize) {
  unsafe  {
    let _buf = Vec::from_raw_parts(ptr, 0, cap);
  }
}
*/
// dummy
fn main() {}

struct BlobReader<'a> {
  buf : &'a mut [u8],
  ix : usize,
  end : usize,
}

impl<'a> BlobReader<'a> {
  pub fn new(buf : &'a mut [u8]) -> Self {
    BlobReader{
      buf,
      ix : 0,
      end : 0 
    }
  }
}
impl<'a> Read for BlobReader<'a> {
  fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {

    if self.ix == self.end {
      let l = self.buf.len();
      let mut nb = 0;
      unsafe { update_from_blob(self.buf.as_mut_ptr(), l, &mut nb) };
      let nb = nb as usize;
      // unsafe { touch(self.buf[0] as usize) };
      if nb == 0 {
        return Ok(0);
      }
      self.end = nb;
      self.ix = 0;
    }

    let nb_copy = min(buf.len(), self.end - self.ix);
    buf[..nb_copy].copy_from_slice(&self.buf[self.ix..self.ix+nb_copy]);
    self.ix += nb_copy;

    Ok(nb_copy)
  }
}
