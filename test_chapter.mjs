// test_chapter.mjs — validate chapter adaptation on a public-domain passage.
import { adapt } from "./agent/planner.mjs";

const CHAPTER = `Alice was beginning to get very tired of sitting by her sister on the bank,
and of having nothing to do: once or twice she had peeped into the book her sister was reading,
but it had no pictures or conversations in it, "and what is the use of a book," thought Alice,
"without pictures or conversations?"

So she was considering, as well as she could, for the hot day made her feel very sleepy and stupid,
whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies,
when suddenly a White Rabbit with pink eyes ran close by her.

There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the
Rabbit say to itself, "Oh dear! Oh dear! I shall be late!" But when the Rabbit actually took a watch out of its
waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind
that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning
with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large
rabbit-hole under the hedge.

In another moment down went Alice after it, never once considering how in the world she was to get out again.
The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice
had not a moment to think about stopping herself before she found herself falling down a very deep well.

Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her,
and to wonder what was going to happen next. Down, down, down. Would the fall never come to an end?

Down she came upon a heap of sticks and dry leaves, and the fall was over. Alice was not a bit hurt, and she jumped
up on to her feet in a moment. She found herself in a long, low hall, which was lit up by a row of lamps hanging from
the roof. There were doors all round the hall, but they were all locked.

Suddenly she came upon a little three-legged table, all made of solid glass; there was nothing on it except a tiny
golden key, and Alice's first thought was that it might belong to one of the doors of the hall; but, alas! either the
locks were too large, or the key was too small, but at any rate it would not open any of them. However, on the second
time round, she came upon a low curtain she had not noticed before, and behind it was a little door about fifteen inches
high: she tried the little golden key in the lock, and to her great delight it fitted!

Alice opened the door and found that it led into a small passage, not much larger than a rat-hole: she knelt down and
looked along the passage into the loveliest garden you ever saw. How she longed to get out of that dark hall, but she
could not even get her head through the doorway.

Soon her eye fell on a little glass box that was lying under the table: she opened it, and found in it a very small cake,
on which the words "EAT ME" were beautifully marked in currants.`;

const t0 = Date.now();
const { plan } = await adapt(CHAPTER, { maxScenes: 12 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== CHAPTER ADAPTATION (${secs}s) ===`);
console.log(`title:  ${plan.title}`);
console.log(`style:  ${plan.style}`);
console.log(`chars:  ${(plan.characters || []).map(c => `${c.name}(${c.voice})`).join(", ")}`);
console.log(`scenes: ${plan.scenes.length}\n`);
for (const s of plan.scenes) {
  console.log(`  ${String(s.id).padStart(2)}. [${s.setting}]`);
  console.log(`      ${s.beat}`);
}
