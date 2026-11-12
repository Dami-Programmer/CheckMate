// Plain-language explanations for people who find legal writing hard.
// Short sentences, everyday words. One entry per checklist type (1-12),
// plus a list of common hard legal words with simple meanings.
//
// Later, when a real AI is connected, the server can also rewrite each exact
// sentence in plain words; these stay as the always-available fallback.

export interface SimpleExplanation {
  says: string; // what the clause says
  means: string; // what it means for you
  tip: string; // what you can do
}

export const SIMPLE: Record<number, SimpleExplanation> = {
  1: {
    says: "They will keep charging you every month or every year. It does not stop by itself.",
    means: "If you forget to cancel, you keep paying. Cancelling may be hard or take many steps.",
    tip: "Write down the date it renews. Find out how to cancel before you need to.",
  },
  2: {
    says: "They can charge you fees, or change the price later.",
    means: "You might pay more than you expected. You may not get your money back if you change your mind.",
    tip: "Check all the fees before you pay. Look for the words “no refund”.",
  },
  3: {
    says: "They can give or sell information about you to other companies.",
    means: "Other companies may learn things about you, like what you like or buy. They often use it to show you ads.",
    tip: "Look in the app's settings for “ads” or “privacy”, and turn sharing off if you can.",
  },
  4: {
    says: "The app can look at your contacts, photos, messages or where you are.",
    means: "They can see private things on your phone, like who you know and where you go.",
    tip: "Only allow what the app really needs. You can say “no” in your phone's settings.",
  },
  5: {
    says: "Even after you delete your account, they can keep your information.",
    means: "Deleting your account does not mean your data is gone. They may keep it for a long time.",
    tip: "Ask them in writing to delete your data. Do not share things you would not want kept.",
  },
  6: {
    says: "They can change these rules whenever they want.",
    means: "The rules you agreed to today can change later, and they may not tell you first.",
    tip: "Check the rules again from time to time, especially before paying.",
  },
  7: {
    says: "They can close or block your account whenever they want.",
    means: "You could lose your account, your money in it, or your files, even without a clear reason.",
    tip: "Keep your own copy of important things. Do not keep all your money in one place.",
  },
  8: {
    says: "If you have a problem with them, you cannot take them to a normal court.",
    means: "A private judge (called an arbitrator) decides instead, often chosen and paid by the company. You also cannot join other people to complain together.",
    tip: "Look for an “opt out” part. Some companies let you say no to this within 30 days.",
  },
  9: {
    says: "Things you post, like photos, videos or words, they are allowed to use.",
    means: "They can copy, change and share what you post, often for free and sometimes forever.",
    tip: "Think before you post anything private or anything you might want to sell one day.",
  },
  10: {
    says: "If you owe them money, they can try hard to collect it.",
    means: "They might contact your family, friends or work, or report you to a credit bureau. That can make it harder to borrow money later.",
    tip: "Pay on time if you can. If you cannot, talk to them early about a payment plan.",
  },
  11: {
    says: "They can take money from your bank account or card by themselves.",
    means: "Money can leave your account without them asking you each time.",
    tip: "Check your bank account often. Know how to stop the payments if you need to.",
  },
  12: {
    says: "Good news: you can ask them to delete your information.",
    means: "You have some control over your data. You can ask them to remove it.",
    tip: "Find the “delete account” or “privacy” page, or email them to ask.",
  },
};

// Hard legal words -> simple meanings. Matched against the exact sentence.
export const HARD_WORDS: [RegExp, string, string][] = [
  [/\barbitrat(ion|or|e)\b/i, "Arbitration", "A private judge decides the problem, not a normal court."],
  [/\bclass[- ]action\b/i, "Class action", "Many people joining together to take a company to court."],
  [/\bwaive[sd]?\b|\bwaiver\b/i, "Waive", "To give up a right you would normally have."],
  [/\bindemnif(y|ies|ication)\b/i, "Indemnify", "You promise to pay their costs if someone sues them because of you."],
  [/\bliab(le|ility)\b/i, "Liability", "Being responsible for paying when something goes wrong."],
  [/\bperpetual\b/i, "Perpetual", "Forever. It never ends."],
  [/\birrevocable\b/i, "Irrevocable", "Cannot be taken back or cancelled."],
  [/\broyalty[- ]free\b/i, "Royalty-free", "They don't have to pay you anything."],
  [/\bsub-?licen[cs](e|able)\b/i, "Sublicense", "They can let other companies use it too."],
  [/\blicen[cs]e\b/i, "License", "Permission to use something."],
  [/\bthird[- ]part(y|ies)\b/i, "Third party", "Another company or person, not you and not them."],
  [/\baffiliates?\b/i, "Affiliates", "Other companies that belong to the same group or owner."],
  [/\bjurisdiction\b/i, "Jurisdiction", "Which country's or state's courts and laws apply."],
  [/\bgoverning law\b/i, "Governing law", "Which place's laws are used to decide problems."],
  [/\bterminat(e|ion|ed)\b/i, "Terminate", "To end or close something, like your account."],
  [/\bsuspend(ed|sion)?\b|\bsuspension\b/i, "Suspend", "To stop or block something for a while."],
  [/\bdiscretion\b/i, "At their discretion", "They decide, however they want."],
  [/\bwithout (prior )?notice\b/i, "Without notice", "Without telling you first."],
  [/\bauto(matic(ally)?)?[- ]?renew(al|s|ed)?\b/i, "Auto-renew", "It starts again and charges you again by itself."],
  [/\brecurring\b/i, "Recurring", "Happens again and again, like every month."],
  [/\bnon-?refundable\b/i, "Non-refundable", "You will not get your money back."],
  [/\brefund\b/i, "Refund", "Getting your money back."],
  [/\bdebit\b/i, "Debit", "To take money out of your account."],
  [/\bset[- ]?off\b/i, "Set-off", "They take money you owe them from money they hold for you."],
  [/\bcredit (bureau|reference|report)/i, "Credit bureau", "A company that keeps a record of how you pay back money."],
  [/\bretain(ed|s)?\b|\bretention\b/i, "Retain", "To keep. Here, to keep your information."],
  [/\bpersonal (data|information)\b/i, "Personal data", "Information about you, like your name, phone, or what you do online."],
  [/\bconsent\b/i, "Consent", "Saying yes, giving permission."],
  [/\bopt[- ]out\b/i, "Opt out", "Saying no, choosing not to be part of something."],
  [/\bbinding\b/i, "Binding", "You must follow it. It is final."],
  [/\bin perpetuity\b/i, "In perpetuity", "Forever."],
  [/\bworldwide\b/i, "Worldwide", "Everywhere in the world."],
  [/\btransferable\b/i, "Transferable", "They can pass this right on to another company."],
  [/\bnon-?exclusive\b/i, "Non-exclusive", "You can still give the same permission to others too."],
  [/\bwarrant(y|ies)\b/i, "Warranty", "A promise that something works or is true."],
  [/\bas is\b/i, "“As is”", "You get it the way it is, with no promise it works well."],
  [/\bdisclose[sd]?\b|\bdisclosure\b/i, "Disclose", "To share or reveal information."],
  [/\bprocess(ing)? (your|personal)/i, "Process data", "To collect, store, use or share information."],
  [/\bbiometric\b/i, "Biometric", "Body details like your face, fingerprint or voice."],
  [/\bgeolocation|precise location\b/i, "Location", "Where you are, from your phone or device."],
  [/\bcollections? agenc(y|ies)\b/i, "Collection agency", "A company paid to chase people who owe money."],
];

export function hardWordsIn(sentence: string): { word: string; meaning: string }[] {
  const found: { word: string; meaning: string }[] = [];
  for (const [re, word, meaning] of HARD_WORDS) {
    if (re.test(sentence) && !found.some((f) => f.word === word)) found.push({ word, meaning });
  }
  return found.slice(0, 6);
}
