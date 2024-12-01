import mongoose, { Document, Schema } from 'mongoose';

// Define an interface for the voting round document
interface VotingRound extends Document {
  roundName: string;
  startDate: Date;
  endDate: Date;
  nominationStartDate: Date;
  nominationEndDate: Date;
}

// Create the Mongoose schema
const VotingRoundSchema: Schema = new Schema({
  roundName: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  nominationStartDate: { type: Date, required: true },
  nominationEndDate: { type: Date, required: true }
});

// Create and export the model
const VotingRoundModel = mongoose.model<VotingRound>('VotingRound', VotingRoundSchema);

export default VotingRoundModel;