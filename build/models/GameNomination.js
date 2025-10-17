import mongoose, { Schema } from 'mongoose';
// Create the Mongoose schema
const GameNominationSchema = new Schema({
    nomination: { type: String, required: true },
    votingRound: { type: Schema.Types.ObjectId, ref: 'VotingRound', required: true },
    nominationType: { type: String, enum: ['GOTM', 'NR-GOTM'], required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    createdAt: { type: Date, default: Date.now }
});
// Create and export the model
const GameNomination = mongoose.model('GameNomination', GameNominationSchema);
export default GameNomination;
