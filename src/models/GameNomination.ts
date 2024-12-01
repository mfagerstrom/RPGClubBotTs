import mongoose, { Document, Schema, Types } from 'mongoose';
import VotingRoundModel from './VotingRound.js'; 
import MemberModel from './Member.js'; 

// Define an interface for the nomination document
interface GameNomination extends Document {
  nomination: string;
  votingRound: Types.ObjectId; // Reference to the VotingRound
  nominationType: 'GOTM' | 'NR-GOTM'; // Type of the nomination
  memberId: Types.ObjectId; // Reference to the Members schema
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
const GameNominationModel = mongoose.model<GameNomination>('GameNomination', GameNominationSchema);

export default GameNominationModel;