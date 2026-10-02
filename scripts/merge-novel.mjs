import fs from "node:fs";

const worldPath = "data/world.json";
const partPaths = [
  "data/novel/arc1/part-01.json",
  "data/novel/arc1/part-02.json",
  "data/novel/arc1/part-03.json",
  "data/novel/arc1/part-04.json",
  "data/novel/arc1/part-05.json",
  "data/novel/arc1/part-06.json"
];

const db = JSON.parse(fs.readFileSync(worldPath, "utf8"));
const chapters = partPaths.flatMap(path => {
  const part = JSON.parse(fs.readFileSync(path, "utf8"));
  return Array.isArray(part.chapters) ? part.chapters : [];
});
chapters.sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0));
db.novel = db.novel || {};
db.novel.chapters = chapters;
db.novel.updatedAt = new Date().toISOString();
db.version = Number(db.version || 1) + 1;
if (db.project) db.project.updatedAt = new Date().toISOString();
fs.writeFileSync(worldPath, JSON.stringify(db, null, 2) + "\n");
