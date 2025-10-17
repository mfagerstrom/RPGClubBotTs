import mongoose, { Schema } from 'mongoose';
// Create the Mongoose schema
const VotingRoundSchema = new Schema({
    roundName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    nominationStartDate: { type: Date, required: true },
    nominationEndDate: { type: Date, required: true }
});
// Create and export the model
const VotingRound = mongoose.model('VotingRound', VotingRoundSchema);
export default VotingRound;
