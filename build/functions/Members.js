import Member from '../models/Member.js'; // Ensure this path is correct
export async function getMemberNameFromId(memberId) {
    try {
        const member = await Member.findOne({ id: memberId }).exec();
        if (member) {
            return member.nickname || member.user.globalName || '';
        }
        return '';
    }
    catch (error) {
        console.error('Error fetching member:', error);
        return '';
    }
}
