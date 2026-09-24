// Compatibility for Safari / iPhone (all iPhone browsers use Safari's engine).
// PDF.js reads page text with `for await (… of readableStream)`, which Safari doesn't support yet.
// This adds ReadableStream async iteration where it's missing. Loaded before PDF.js in the page and in its worker.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  const values = function ({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      next() { return reader.read(); },
      async return(value) {
        if (!preventCancel) { try { await reader.cancel(value); } catch {} }
        try { reader.releaseLock(); } catch {}
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; }
    };
  };
  Object.defineProperty(ReadableStream.prototype, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}
