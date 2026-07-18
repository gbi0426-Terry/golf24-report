const DEFAULT_ROOM_ID = "130128070312263491";
const DEFAULT_OWNER = "vrgolf";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const owner = args.owner || DEFAULT_OWNER;
const roomId = args.room || DEFAULT_ROOM_ID;
const date = args.date || new Date().toISOString().slice(0, 10);
const durationMin = Number(args.duration || 60);

const baseUrl = `https://golf24.com.tw/${owner}/`;

function parseMinutes(timeText) {
  const [hour, minute] = timeText.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(value) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hour = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minute = String(normalized % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

async function getJson(path, params = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json();
}

function getDayOpening(openingInfo, targetDate) {
  const day = new Date(`${targetDate}T00:00:00+08:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  const firstPlan = openingInfo[0];
  if (!firstPlan) return [];
  return (isWeekend ? firstPlan.weekend : firstPlan.weekday).map((slot) => ({
    start: parseMinutes(slot.start),
    end: parseMinutes(slot.end === "24:00" ? "24:00" : slot.end),
    price: slot.price,
  }));
}

function buildAvailableStarts(openingSlots, bookedSlots, stepMin, duration) {
  const starts = [];
  for (const opening of openingSlots) {
    for (let start = opening.start; start + duration <= opening.end; start += stepMin) {
      const end = start + duration;
      const hasConflict = bookedSlots.some((booked) =>
        overlaps(start, end, booked.start, booked.end),
      );
      if (!hasConflict) {
        starts.push({
          start: formatMinutes(start),
          end: formatMinutes(end),
          price: opening.price,
        });
      }
    }
  }
  return starts;
}

const ownerInfo = await getJson("ownerinfo", { QRID: roomId });
const opening = await getJson("get_room_opening", { QRID: roomId });
const booked = await getJson("get_room_bookingtime", { QRID: roomId });

const timeUnit = Number(opening.timeunit || ownerInfo.timeunit || 30);
const openingSlots = getDayOpening(opening.openinginfo || [], date);
const bookedSlots = booked
  .filter((slot) => slot.date === date)
  .map((slot) => ({
    name: slot.name,
    startText: slot.start,
    endText: slot.end,
    start: parseMinutes(slot.start),
    end: parseMinutes(slot.end === "00:00" ? "24:00" : slot.end),
  }))
  .sort((a, b) => a.start - b.start);

const availableStarts = buildAvailableStarts(
  openingSlots,
  bookedSlots,
  timeUnit,
  durationMin,
);

console.log(JSON.stringify({
  room: {
    owner,
    roomId,
    title: ownerInfo.title,
    timeUnit,
  },
  query: {
    date,
    durationMin,
  },
  booked: bookedSlots.map((slot) => ({
    start: slot.startText,
    end: slot.endText,
    name: slot.name,
  })),
  availableStarts,
}, null, 2));
