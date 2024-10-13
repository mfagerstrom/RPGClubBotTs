import members from '../data/members.json' assert { type: "json" };

export async function getMemberNameFromId(memberId: string) {
    for (let x: number = 0; x < members.length; x++) {
        if (members[x].id === memberId) {
            if (members[x].nickname)
                return members[x].nickname;
            return members[x].user.globalName;
        }
    }

    return '';
}