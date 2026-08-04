/**
 * Converts a numerical amount to Nigerian Naira in words format.
 * Example: 150500.50 -> "One Hundred and Fifty Thousand, Five Hundred Naira and Fifty Kobo Only"
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

function convertLessThanThousand(n: number): string {
  if (n === 0) return ""

  if (n < 20) {
    return ONES[n]
  }

  if (n < 100) {
    const ten = Math.floor(n / 10)
    const remainder = n % 10
    return TENS[ten] + (remainder > 0 ? " " + ONES[remainder] : "")
  }

  const hundred = Math.floor(n / 100)
  const remainder = n % 100
  const hundredText = ONES[hundred] + " Hundred"
  if (remainder > 0) {
    return hundredText + " and " + convertLessThanThousand(remainder)
  }
  return hundredText
}

export function numberToNairaWords(amount: number): string {
  if (!amount || isNaN(amount) || amount <= 0) return ""

  const rounded = Math.round(amount * 100) / 100
  const wholePart = Math.floor(rounded)
  const koboPart = Math.round((rounded - wholePart) * 100)

  if (wholePart === 0 && koboPart === 0) return "Zero Naira Only"

  let words = ""

  if (wholePart > 0) {
    const billion = Math.floor(wholePart / 1000000000)
    let remainder = wholePart % 1000000000

    const million = Math.floor(remainder / 1000000)
    remainder = remainder % 1000000

    const thousand = Math.floor(remainder / 1000)
    remainder = remainder % 1000

    if (billion > 0) {
      words += convertLessThanThousand(billion) + " Billion "
    }

    if (million > 0) {
      words += convertLessThanThousand(million) + " Million "
    }

    if (thousand > 0) {
      words += convertLessThanThousand(thousand) + " Thousand "
    }

    if (remainder > 0) {
      if (words.length > 0 && remainder < 100 && !words.includes("and")) {
        words += "and "
      }
      words += convertLessThanThousand(remainder) + " "
    }

    words = words.trim() + " Naira"
  }

  if (koboPart > 0) {
    const koboWords = convertLessThanThousand(koboPart) + " Kobo"
    if (words.length > 0) {
      words += " and " + koboWords
    } else {
      words = koboWords
    }
  }

  return words + " Only"
}
