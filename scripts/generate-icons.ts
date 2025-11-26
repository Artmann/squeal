import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const iconsDirectory = join(import.meta.dirname, '..', 'assets', 'icons')
const sourceIcon = join(iconsDirectory, 'icon.png')

const sizes = [16, 32, 64, 128, 256, 512]

async function generatePngVariants() {
  console.log('Generating PNG variants...')

  for (const size of sizes) {
    const outputPath = join(iconsDirectory, `${size}x${size}.png`)

    await sharp(sourceIcon).resize(size, size).toFile(outputPath)

    console.log(`  Created ${size}x${size}.png`)
  }
}

async function generateIco() {
  console.log('Generating Windows .ico...')

  const pngPaths = [256, 128, 64, 32, 16].map((size) =>
    join(iconsDirectory, `${size}x${size}.png`)
  )

  const icoBuffer = await pngToIco(pngPaths)
  const icoPath = join(iconsDirectory, 'icon.ico')

  await Bun.write(icoPath, icoBuffer)

  console.log('  Created icon.ico')
}

async function generateIcns() {
  console.log('Generating macOS .icns...')

  const iconsetPath = join(iconsDirectory, 'icon.iconset')

  if (existsSync(iconsetPath)) {
    rmSync(iconsetPath, { recursive: true })
  }

  mkdirSync(iconsetPath)

  // macOS iconset requires specific naming convention with @2x variants.
  const iconsetSizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' }
  ]

  for (const { size, name } of iconsetSizes) {
    await sharp(sourceIcon).resize(size, size).toFile(join(iconsetPath, name))
  }

  // Use iconutil (built into macOS) to create .icns.
  const icnsPath = join(iconsDirectory, 'icon.icns')

  execSync(`iconutil -c icns "${iconsetPath}" -o "${icnsPath}"`)

  // Clean up the iconset directory.
  rmSync(iconsetPath, { recursive: true })

  console.log('  Created icon.icns')
}

async function main() {
  console.log('Generating app icons from', sourceIcon)
  console.log('')

  if (!existsSync(sourceIcon)) {
    console.error('Error: Source icon not found at', sourceIcon)
    process.exit(1)
  }

  await generatePngVariants()
  await generateIco()
  await generateIcns()

  console.log('')
  console.log('Done!')
}

main()
