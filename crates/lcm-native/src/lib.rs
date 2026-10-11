mod assemble;
mod db;
mod messages;
mod migrate;
mod schema;
mod summaries;
mod text;
mod types;

#[cfg(test)]
mod tests;

pub(crate) trait Sql<T> {
    fn sq(self) -> napi::Result<T>;
}

impl<T> Sql<T> for rusqlite::Result<T> {
    fn sq(self) -> napi::Result<T> {
        self.map_err(|e| napi::Error::from_reason(e.to_string()))
    }
}

pub(crate) fn fail<T>(message: impl Into<String>) -> napi::Result<T> {
    Err(napi::Error::from_reason(message.into()))
}

pub(crate) fn io_err(e: std::io::Error) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}
