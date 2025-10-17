import mongoose, { Schema } from 'mongoose';
const PresenceSchema = new Schema({
    activityName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
const Presence = mongoose.model('Presence', PresenceSchema);
export default Presence;
