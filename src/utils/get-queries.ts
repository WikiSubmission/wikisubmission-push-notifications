export function getQueries(queryObject: any, paramObject: any, bodyObject: any): Record<string, string> {
    return {
        ...queryObject,
        ...paramObject,
        ...bodyObject,
    };
}