// Fun facts about art, shown while the camera learns the artwork.
export const FACTS = [
  'Michelangelo painted the Sistine Chapel ceiling standing up on scaffolding he designed, not lying on his back.',
  'Ultramarine blue was ground from lapis lazuli mined in Afghanistan, and at times it cost more than gold.',
  '"Mummy brown" was a real paint pigment, made from ground-up ancient Egyptian mummies.',
  'The cave paintings at Lascaux in France are around 17,000 years old.',
  'Some cave art on the Indonesian island of Sulawesi is more than 45,000 years old.',
  'Leonardo da Vinci filled his notebooks with mirror writing, running from right to left.',
  'Van Gogh painted The Starry Night in 1889, from the view out of his window at the asylum in Saint-Rémy.',
  'Edvard Munch made several versions of The Scream, in paint, pastel and as a lithograph print.',
  'The Mona Lisa is small: about 77 × 53 cm.',
  'Salvador Dalí\'s The Persistence of Memory is only about 24 × 33 cm.',
  'Seurat spent about two years painting A Sunday Afternoon on the Island of La Grande Jatte, dot by dot.',
  'Hokusai\'s The Great Wave is a woodblock print, and thousands of copies were printed from the carved blocks.',
  'The paint tube was invented in 1841. It let painters like the Impressionists work outdoors.',
  'Tyrian purple, the colour of emperors, was extracted from thousands of sea snails.',
  'Frida Kahlo painted around 55 self-portraits.',
  'The Garima Gospels from Ethiopia are among the oldest illustrated Christian manuscripts in the world.',
  'Afewerk Tekle designed the monumental stained-glass windows of Africa Hall in Addis Ababa.',
  'The tallest standing stele at Aksum in Ethiopia rises about 24 metres, carved from a single block of granite.',
  'Gold leaf can be beaten thinner than a ten-thousandth of a millimetre.',
  'In 2018 Banksy\'s Girl with Balloon shredded itself moments after it sold at auction.',
  'The first NFT artwork, "Quantum" by Kevin McCoy, was minted in 2014.',
  'Pointillism works because your eye blends neighbouring dots of pure colour into new colours.',
  'Golden hour, the hour after sunrise and before sunset, is when sunlight travels through the most atmosphere and turns warm and soft.',
  'Lens flares like the one in this artwork happen when bright light scatters inside a camera lens.',
];

export function shuffledFacts() {
  const a = FACTS.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
