export function hasTimePassed(
    date: string, 
    unit: number, 
    measure: 'seconds' | 'minutes' | 'hours'
  ): boolean {
    const now = new Date();
    const targetDate = new Date(date);
  
    if (isNaN(targetDate.getTime())) {
      throw new Error('Invalid date string');
    }
  
    // convert everything to milliseconds
    let msToCompare: number;
    switch (measure) {
      case 'seconds':
        msToCompare = unit * 1000;
        break;
      case 'minutes':
        msToCompare = unit * 1000 * 60;
        break;
      case 'hours':
        msToCompare = unit * 1000 * 60 * 60;
        break;
      default:
        throw new Error(`Invalid measure: ${measure}`);
    }
  
    const diff = now.getTime() - targetDate.getTime();
  
    return diff >= msToCompare;
  }