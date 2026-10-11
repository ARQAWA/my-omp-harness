fn main() {
    napi_build::setup();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // Node-API symbols come from the host process; test binaries need the same lookup rule as the cdylib.
        println!("cargo:rustc-link-arg=-Wl,-undefined,dynamic_lookup");
    }
}
