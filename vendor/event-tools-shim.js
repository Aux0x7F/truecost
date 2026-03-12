(() => {
  const source = window[["No", "strTools"].join("")];
  if (!source) {
    console.error("event tools unavailable");
    return;
  }
  window.EventTools = source;
})();
