import mongoose, { Schema, Document } from 'mongoose';

interface IUser {
  username: string;
  globalName: string;
  avatar: string | null;
}

export interface IMember extends Document {
  id: string;
  joinedTimestamp: Date | null;
  partedTimestamp?: Date | null;
  nickname: string | null;
  user: IUser;
  roles: IRole[]; 
}

interface IRole {
  roleId: string;
  roleName: string;
} 

// models/Member.ts
const UserSchema: Schema = new Schema({
  username: { type: String, required: true },
  globalName: { type: String, required: true, default: 'Unknown' },
  avatar: { type: String, required: false }
});

const RoleSchema: Schema = new Schema({
  roleId: { type: String, required: true },
  roleName: { type: String, required: true }
});

const MemberSchema: Schema = new Schema({
  id: { type: String, required: true },
  joinedTimestamp: { type: Date, required: false },
  partedTimestamp: { type: Date, required: false },
  nickname: { type: String, required: false },
  user: { type: UserSchema, required: true },
  roles: [RoleSchema] 
});

const Member = mongoose.model<IMember>('Member', MemberSchema);
export default Member;