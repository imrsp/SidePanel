export function formatUptime(seconds:number):string {
 const minutes=Math.floor(Math.max(0,seconds)/60);
 const hours=Math.floor(minutes/60);
 return hours<24?`${hours}h ${minutes%60}m`:`${Math.floor(hours/24)}d ${hours%24}h`;
}
