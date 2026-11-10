// The 12 clause types CheckMate looks for.
// Red = serious risk (-2 score), orange = worth knowing (-1), green = good for you (0).

export type FlagColor = "red" | "orange" | "green";

export interface ClauseType {
  id: number;
  name: string;
  color: FlagColor;
  definition: string;
}

export const CHECKLIST: ClauseType[] = [
  {
    id: 1,
    name: "Auto-renewal & cancellation",
    color: "orange",
    definition: "Renews and charges automatically, or requires advance notice to cancel.",
  },
  {
    id: 2,
    name: "Fees, refunds & price changes",
    color: "orange",
    definition: "Extra fees, limited or no refunds, or prices that can change without notice.",
  },
  {
    id: 3,
    name: "Data sold or shared for ads",
    color: "red",
    definition: "Your personal data is sold, shared with third parties or used for advertising.",
  },
  {
    id: 4,
    name: "Access to contacts, photos or location",
    color: "red",
    definition: "The app can read your contacts, photos, files, messages or location.",
  },
  {
    id: 5,
    name: "Data kept after deletion",
    color: "red",
    definition: "Your data is kept after you delete your account.",
  },
  {
    id: 6,
    name: "Terms change without notice",
    color: "orange",
    definition: "They can change the terms without telling you directly.",
  },
  {
    id: 7,
    name: "Account closed without reason",
    color: "orange",
    definition: "They can suspend or close your account at any time, for any reason.",
  },
  {
    id: 8,
    name: "Forced arbitration / no class action",
    color: "red",
    definition: "You give up your right to go to court or join a group lawsuit.",
  },
  {
    id: 9,
    name: "Broad license to your content",
    color: "orange",
    definition: "They get wide rights to use, copy or share what you upload.",
  },
  {
    id: 10,
    name: "Debt collection & contacting others",
    color: "red",
    definition: "They may contact your friends, family or employer, or use aggressive collection methods.",
  },
  {
    id: 11,
    name: "Automatic access to your money",
    color: "red",
    definition: "They can debit your bank account or card automatically, including penalty charges.",
  },
  {
    id: 12,
    name: "You can delete your data",
    color: "green",
    definition: "You can request deletion of your account and personal data.",
  },
];

// Look up a clause type by its number (1-12).
export function getClauseType(id: number): ClauseType | undefined {
  return CHECKLIST.find((t) => t.id === id);
}
