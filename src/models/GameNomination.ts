import mongoose, { Document, Schema, Types } from 'mongoose';
import { IMember } from './Member.js';
import { IVotingRound } from './VotingRound';

// Define an interface for the nomination document
export interface IGameNomination extends Document {
  id: string;
  nomination: string;
  votingRound: IVotingRound;
  nominationType: 'GOTM' | 'NR-GOTM'; // Type of the nomination
  member: IMember;
  createdAt: Date;
}

// Create the Mongoose schema
const GameNominationSchema: Schema = new Schema({
  nomination: { type: String, required: true },
  votingRound: { type: Schema.Types.ObjectId, ref: 'VotingRound', required: true },
  nominationType: { type: String, enum: ['GOTM', 'NR-GOTM'], required: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Create and export the model
const GameNomination = mongoose.model<IGameNomination>('GameNomination', GameNominationSchema);

export default GameNomination;