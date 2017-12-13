extern crate image;
extern crate crypto;
extern crate lz4;
extern crate base64;
extern crate compress;
extern crate rand;
use crypto::bcrypt_pbkdf::bcrypt_pbkdf;
use crypto::chacha20::ChaCha20;
use crypto::symmetriccipher::SynchronousStreamCipher;
use rand::OsRng;
use rand::Rng;
use std::process::Command;
use image::png::PNGDecoder;
use image::ImageDecoder;
use image::ImageError;
use compress::lz4::{
  Decoder as LZDec,
};
use std::ffi::OsString;
use std::fs::{
  self,
  File,
};
use std::path::{
  Path,
  PathBuf,
};
use std::io::{
  Read,
  Write,
  Result as IoResult,
};
const inputspath : &str = "./input/";
const outputspath : &str = "./output/";
const passphrase : &str = "minepassphrase";
const nbround : u32 = 16;
fn main() {
  for e in fs::read_dir(inputspath).unwrap() {
    let e = e.unwrap();
    transform(e.path(),e.file_name()).unwrap();
  }
}

fn transform(file : PathBuf, file_name : OsString) -> IoResult<()> {

  let dest = PathBuf::from(outputspath);
  let dest = &dest;
  let file_name = &file_name;
  //compress(file.as_path(),dest_path(dest,file_name,"_c1").as_path())?;
  // check decompress with rust impl
  Command::new("lz4")
        .arg("-9")
        .arg(file.as_path())
        .arg(dest_path(dest,file_name,"_c1").as_path())
        .output().unwrap_or_else(|e| {
            panic!("failed to execute process: {}", e)
    }); 
  decompress(dest_path(dest,file_name,"_c1").as_path(),dest_path(dest,file_name,"_dc1").as_path())?;
  to_full_pic(file.as_path(),dest_path(dest,file_name,"_fp").as_path())?;
  Command::new("lz4")
        .arg("-9")
        .arg(dest_path(dest,file_name,"_fp").as_path())
        .arg(dest_path(dest,file_name,"_c2").as_path())
        .output().unwrap_or_else(|e| {
            panic!("failed to execute process: {}", e)
    }); 
  let mut salt = vec![0;32];
  let mut pass_bytes = vec![0;32];
  OsRng::new().unwrap().fill_bytes(&mut salt);
  let salt = salt;
  bcrypt_pbkdf(&passphrase.as_bytes()[..],&salt[..],nbround,&mut pass_bytes[..]);
  println!("passphrase : {}", &passphrase);
  println!("passphrasebyte : {}", base64::encode(&passphrase.as_bytes()));
  println!("salt : {}", base64::encode(&salt));
  println!("nbround : {}", nbround);
  println!("derived key : {}", base64::encode(&pass_bytes));


  let salt_c1 = encipher(dest_path(dest,file_name,"_fp").as_path(),dest_path(dest,file_name,"_fp_enc").as_path(),&pass_bytes[..])?;
/*    Command::new("lz4")
        .arg("-9")
        .arg(dest_path(dest,file_name,"_fp_enc").as_path())
        .arg(dest_path(dest,file_name,"_c3").as_path())
        .output().unwrap_or_else(|e| {
            panic!("failed to execute process: {}", e)
    }); */

  let salt_c2 = encipher(dest_path(dest,file_name,"_c2").as_path(),dest_path(dest,file_name,"_c2_enc").as_path(),&pass_bytes[..])?;

//  decipher(dest_path(dest,file_name,"_fp_enc").as_path(),dest_path(dest,file_name,"_fp_dec").as_path(),&pass_bytes[..],&salt_c1[..])?;
  decipher(dest_path(dest,file_name,"_c2_enc").as_path(),dest_path(dest,file_name,"_c2_dec").as_path(),&pass_bytes[..],&salt_c2[..])?;


  Ok(())
}

fn dest_path(dest : &PathBuf, file_name : &OsString, xt : &str) -> PathBuf {
  let mut path = dest.clone();
  let mut fname = file_name.clone();
  fname.push(xt);
  path.push(fname);
  path
}

fn to_full_pic(src: &Path, dst: &Path) -> IoResult<()>
{
	println!("expand png: {:?} -> {:?}", src, dst);
	let fi = try!(File::open(src));
	let mut fo = try!(File::create(dst));
  let mut dec = PNGDecoder::new(fi);
  let (x,y) = dec.dimensions().unwrap();
  let rl = dec.row_len().unwrap();
  println!("dim : {}, {}",x,y);
  println!("rowlen : {}",rl);
  let is_rgb = rl/(x as usize) == 3;// rgb
  let mut buf1 : Vec<u8> = vec![0;rl];
  // rgba
  let rla = (x as usize) * 4;
  // full alpha
  let mut buf2 : Vec<u8> = vec![255;rla];
  loop {
    match dec.read_scanline(&mut buf1[..]) {
      Ok(i) => {
        let i = i as usize;
        assert!(i == rl);
        if is_rgb {
          let mut ix = 0;
          while ix < rl/3 {
            buf2[ix*4] = buf1[ix*3];
            buf2[ix*4 +1] = buf1[ix*3 +1];
            buf2[ix*4 +2] = buf1[ix*3 +2];
            ix += 1;
          }
          fo.write_all(&buf2[..rla])?;
        } else {
          fo.write_all(&buf1[..rl])?;
        }
      },
      Err(ImageError::ImageEnd) => break,
      Err(e) => panic!("{:?}",e),
      
    }
  }

  Ok(())

}
 
fn encipher(src: &Path, dst: &Path,key : &[u8]) -> IoResult<Vec<u8>> {
	println!("enciph: {:?} -> {:?}", src, dst);
  let mut salt_bciph = vec![0;24];
  OsRng::new().unwrap().fill_bytes(&mut salt_bciph);
  let salt_bciph = salt_bciph;
  println!("salt ciph : {}", base64::encode(&salt_bciph));

  decipher(src,dst,key,&salt_bciph[..])?;

  Ok(salt_bciph)
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
    fo.write_all(&output[..s])?;
    if s != input.len() {
      break;
    }
  }
  Ok(())


}

// differs from std tools could not decode -> use lz4 command to compress
/*fn compress(src: &Path, dst: &Path) -> IoResult<()>
{
	println!("Compressing: {:?} -> {:?}", src, dst);
	let mut fi = try!(File::open(src));
  let mut enc = lz4::EncoderBuilder::new();
  enc.level(9);
  //enc.block_mode(lz4::BlockMode::Independent);
  //enc.block_size(lz4::BlockSize::Max256KB);
  //enc.checksum(lz4::ContentChecksum::ChecksumEnabled);

	let mut fo = try!(lz4::EncoderBuilder::new().build(try!(File::create(dst))));
	try!(copy(&mut fi, &mut fo));
	match fo.finish() {
		(_, result) => result
	}
}*/

fn decompress(src: &Path, dst: &Path) -> IoResult<()> {
	println!("Decompressing: {:?} -> {:?}", src, dst);
	let mut fo = File::create(dst)?;
	let mut fi = LZDec::new(File::open(src)?);
  copy(&mut fi, &mut fo)?;
  Ok(())
}

fn copy(src: &mut Read, dst: &mut Write) -> IoResult<()>
{
	let mut buffer: [u8; 1024] = [0; 1024];
	loop
	{
		let len = try! (src.read(&mut buffer));
		if len == 0
		{
			break;
		}
		try!(dst.write_all(&buffer[0..len]));
	}
	Ok(())
}
