SHELL := /bin/bash

all:
	cargo build --target=wasm32-unknown-unknown --release
	mkdir -p site
	find target/wasm32-unknown-unknown/release/deps -type f -name "*.wasm" | xargs -I {} cp {} site/cv_full.wasm
	wasm-gc site/cv_full.wasm site/cv.wasm

