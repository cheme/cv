//! wasm utilities for pic display

#![feature(allocator_api)]
#![feature(link_args)]

extern crate compress;

extern crate crypto;

use crypto::chacha20::ChaCha20;
use crypto::symmetriccipher::SynchronousStreamCipher;
use crypto::bcrypt_pbkdf::bcrypt_pbkdf;
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
  fn down_buf_add(_ : *const u8, _ : usize);
  fn update_from_blob(_ : *mut u8, _ : usize) -> usize;
  fn touch(_ : usize);
  fn wasm_log(_ : *const c_char, _ : LogType);
}

#[no_mangle]
pub extern "C" fn bcrypt_key_der(pass : *const u8, pass_length : usize, salt : *const u8, nb_round : u32) -> *const u8 {
  let pass = unsafe {
    slice::from_raw_parts(pass, pass_length)
  }; 
  let salt = unsafe {
    slice::from_raw_parts(salt, 32)
  }; 
  let mut output = vec![0;32];
  bcrypt_pbkdf(&pass[..],&salt[..],nb_round,&mut output[..]);

  mem::forget(&output);
  return output.as_ptr() as *const u8;
}

#[no_mangle]
pub extern "C" fn pbkdf_test(nb_round : u32) {
  let pass = vec![8;30];
  let salt = vec![1;32];
  let mut output = vec![0;32];
  bcrypt_pbkdf(&pass[..],&salt[..],nb_round,&mut output[..]);
}

#[no_mangle]
pub extern "C" fn decompress_enc_display(empty_buff: *mut u8, buf_length : usize, width : usize, nb_line_disp : usize,pass_buff: *const u8,salt_buff: *const u8) {
 let empty_buff = unsafe {
    slice::from_raw_parts_mut(empty_buff, buf_length)
 };
 let pass = unsafe {
    slice::from_raw_parts(pass_buff, 32)
 }; 
 let salt = unsafe {
    slice::from_raw_parts(salt_buff, 24)
 }; 

 decompress_enc_display_inner(empty_buff, width, nb_line_disp, pass,salt).unwrap_or_else(|e| {
   log_js(format!("{:?}",e), LogType::Error);
 });
}

#[inline]
fn decompress_enc_display_inner(empty_buff: &mut [u8], width : usize, nb_line_disp : usize,pass: &[u8],salt: &[u8]) -> IoResult<()> {
  let input = BlobReader::new(empty_buff);

  let dec_read = ChaChaReader::new(input,pass,salt);

  let mut dec_i = LZDec::new(dec_read);

  write_pic_from_read(&mut dec_i, width, nb_line_disp)?;
  Ok(())
}

#[no_mangle]
pub extern "C" fn enc_display(empty_buff: *mut u8, buf_length : usize, width : usize, nb_line_disp : usize,pass_buff: *const u8,salt_buff: *const u8) {
 let empty_buff = unsafe {
    slice::from_raw_parts_mut(empty_buff, buf_length)
 };
 let pass = unsafe {
    slice::from_raw_parts(pass_buff, 32)
 }; 
 let salt = unsafe {
    slice::from_raw_parts(salt_buff, 24)
 }; 

 enc_display_inner(empty_buff, width, nb_line_disp, pass, salt).unwrap_or_else(|e| {
   log_js(format!("{:?}",e), LogType::Error);
 });

}

#[inline]
fn enc_display_inner(empty_buff: &mut [u8], width : usize, nb_line_disp : usize,pass: &[u8], salt: &[u8]) -> IoResult<()> {
  let input = BlobReader::new(empty_buff);

  let mut dec_i = ChaChaReader::new(input,pass,salt);

  write_pic_from_read(&mut dec_i, width, nb_line_disp)?;
  Ok(())

}
//function direct_display(b,ctx) {
#[no_mangle]
pub extern "C" fn decompress_display(empty_buff: *mut u8, buf_length : usize, width : usize, nb_line_disp : usize) {
  let empty_buff = unsafe {
    slice::from_raw_parts_mut(empty_buff, buf_length)
  }; 

  let input = BlobReader::new(empty_buff);


	let mut dec_i = LZDec::new(input);

  write_pic_from_read(&mut dec_i, width, nb_line_disp).unwrap_or_else(|e| {
   log_js(format!("{:?}",e), LogType::Error);
  });
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
pub extern "C" fn enc_download(empty_buff: *mut u8, buf_length : usize, width : usize, nb_line_disp : usize,pass_buff: *const u8,salt_buff: *const u8) {
 let empty_buff = unsafe {
    slice::from_raw_parts_mut(empty_buff, buf_length)
 };
 let pass = unsafe {
    slice::from_raw_parts(pass_buff, 32)
 }; 
 let salt = unsafe {
    slice::from_raw_parts(salt_buff, 24)
 };

 let input = BlobReader::new(empty_buff);

 let mut dec_i = ChaChaReader::new(input,pass,salt);

 // same buf write size rules as for display
 // buf should be global const but no clear use case here
 let buf_w_l = width * 4 * nb_line_disp;

 down_from_read(&mut dec_i, buf_w_l).unwrap_or_else(|e| {
   log_js(format!("{:?}",e), LogType::Error);
 });
}




fn write_pic_from_read<R : Read>(dec_i : &mut R, width : usize, nb_line_disp : usize) -> IoResult<()> {
  let mut disp_buf = vec![0;width * 4 * nb_line_disp];
  let mut y_ix = 0;
  loop {
    let mut i = 0;
    while i < disp_buf.len() {
      let nbr = dec_i.read(&mut disp_buf[i..])?;
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
 
  Ok(())
}
fn down_from_read<R : Read>(dec_i : &mut R, w_b_len : usize) -> IoResult<()> {
  // TODO read buf could be use (nice to have)
  let mut disp_buf = vec![0;w_b_len];
  loop {
    let mut i = 0;
    while i < disp_buf.len() {
      let nbr = dec_i.read(&mut disp_buf[i..])?;
      if nbr == 0 {
        break;
      }
      i += nbr;
    }
    if i == 0 {
      break;
    }
    unsafe { down_buf_add(disp_buf.as_mut_ptr(), i) };
  }
 
  Ok(())
}

/*alternate impl for alloc dealloc kept for testing : issue when using cipher
 * : memory corruption : TODO try to identify -> only after deciphering successfully a pic and
 * changing password (not using dalloc do no solve it)
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
*/
/* 
*/
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
//*/
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
      let nb  = unsafe { update_from_blob(self.buf.as_mut_ptr(), l) };
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
struct ChaChaReader<R : Read> {
  inner : R,
  chacha : ChaCha20,
  input : Vec<u8>,
  output : Vec<u8>,
  start_o : usize,
  end_o : usize,
}

impl<R : Read> ChaChaReader<R> {
  pub fn new(r : R,key : &[u8], salt : &[u8]) -> Self {
    ChaChaReader {
      inner : r,
      chacha : ChaCha20::new_xchacha20(key,salt),
      input : vec![0;64],
      output : vec![0;64],
      start_o : 0,
      end_o : 0,
    }
  }
}



impl<R : Read> Read for ChaChaReader<R> {
  fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
    if self.start_o == self.end_o {
      // try to read full buff
      let s = read_most(&mut self.inner, &mut self.input[..])?;
      if s == 0 {
        return Ok(0);
      }

      self.chacha.process(&self.input[..s], &mut self.output[..s]);
      self.start_o = 0;
      self.end_o = s;
    }
    let to_copy = min(self.end_o - self.start_o, buf.len());

    let n_end = self.start_o + to_copy;
    buf[..to_copy].copy_from_slice(&self.output[self.start_o..n_end]);

    self.start_o = n_end;

    Ok(to_copy)

  }
}

#[inline]
fn read_most<R : Read>(from : &mut R, to : &mut [u8]) -> IoResult<usize> {
  let mut i = 0;
  while i != to.len() {
    let nb = from.read(&mut to[i..])?;
    if nb == 0 {
      return Ok(i);
    }
    i += nb;
  }
  Ok(i)
}


/*
fn decipher(src: &Path, dst: &Path,key : &[u8], salt_bciph : &[u8]) -> IoResult<()> {
	let mut fi = try!(File::open(src));
	let mut fo = try!(File::create(dst));
  // stream gen at this size
  let mut input = vec![0;64];
  let mut output = vec![0;64];
  let mut xchacha20 = ChaCha20::new_xchacha20(&key, &salt_bciph);
  loop {
    let s = read_most(&mut fi, &mut input[..])?;
    if s == 0 {
      break;
    }

    xchacha20.process(&input[..s], &mut output[..s]);
    fo.write_all(&mut output[..s])?;
    if s != input.len() {
      break;
    }
  }
  Ok(())
}
*/

#[repr(u8)]
pub enum LogType { Log = 0, Error = 1, Alert = 2, }

fn log_js(m : String, t : LogType) {
  let m = CString::new(m.into_bytes()).unwrap(); // warn panic on internal \0
  unsafe {
    wasm_log(m.as_ptr(), t)
  }
}


