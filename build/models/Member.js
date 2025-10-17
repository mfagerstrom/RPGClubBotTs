import mongoose, { Schema } from 'mongoose';
// models/Member.ts
const UserSchema = new Schema({
    username: { type: String, required: true },
    globalName: { type: String, required: true, default: 'Unknown' },
    avatar: { type: String, required: false }
});
const RoleSchema = new Schema({
    roleId: { type: String, required: true },
    roleName: { type: String, required: true }
});
const MemberSchema = new Schema({
    id: { type: String, required: true },
    joinedTimestamp: { type: Date, required: false },
    partedTimestamp: { type: Date, required: false },
    nickname: { type: String, required: false },
    user: { type: UserSchema, required: true },
    roles: [RoleSchema]
});
const Member = mongoose.model('Member', MemberSchema);
export default Member;
