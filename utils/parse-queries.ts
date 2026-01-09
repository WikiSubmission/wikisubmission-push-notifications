export function parseQueries(queryObject: any, paramObject: any, bodyObject: any): Record<string, string> {
    return {
        ...queryObject,
        ...paramObject,
        ...bodyObject,
    };
}