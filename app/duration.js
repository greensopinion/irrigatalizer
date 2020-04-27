module.exports = (duration) => {
  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((duration % (1000 * 60)) / 1000);
  const millis = duration % 1000;
  var text = "";
  if (days > 0) {
    text = `${days} days`;
  }
  if (hours > 0) {
    text = `${text} ${hours}h`;
  }
  if (minutes > 0) {
    text = `${text} ${minutes}m`;
  }
  if (seconds > 0) {
    text = `${text} ${seconds}s`;
  }
  var time = text.replace(/\s{2,}/, " ").trim();
  if (!time && millis > 0) {
    time = `${millis}ms`;
  }
  return time || "0s";
};
