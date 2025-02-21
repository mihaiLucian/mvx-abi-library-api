export class GenericUtils {
  static capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  static async sleep(milliseconds: number) {
    return await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
