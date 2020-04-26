module.exports = (timeInMinutes) => {
  const hour = Math.trunc(timeInMinutes/60);
  const minute = timeInMinutes%60;
  var m = `${minute}`;
  if (m.length < 2) {
    m = "0"+m;
  }
  var h = hour;
  if (h > 12) {
    h = h - 12;
  }
  const amPm = (hour>=12)?"pm":"am";
  return `${h}:${m} ${amPm}`;
};